import type { ParseMode } from "grammy/types";

import {
  type RateLimitPolicy,
  SandboxTimeBudget,
  SlidingWindowRateLimiter,
  type TimeBudgetPolicy,
  TIMEOUT_PENALTY_REQUESTS,
  isCodeLengthAllowed,
} from "../security/rateLimiter";
import type { SandboxService } from "../services/sandbox/types";
import {
  formatExecutionDocument,
  formatExecutionMessage,
  formatRejectionMessage,
} from "./formatters/telegramExecutionMessage";

export interface RunnerOptions {
  sandbox: SandboxService;
  rateLimiter: SlidingWindowRateLimiter;
  rateLimitPolicy: RateLimitPolicy;
  timeBudget: SandboxTimeBudget;
  timeBudgetPolicy: TimeBudgetPolicy;
  maxCodeLength: number;
}

export interface RunMessage {
  text: string;
  parseMode: ParseMode;
}

/** Why a request was not run: the user is over a limit, or the code is too long. */
export type RunRefusal = "rate-limit" | "run-time" | "too-long";

export type RunOutcome =
  | {
      ran: true;
      message: RunMessage;
      /** Everything the run produced as plain text, when the message could not hold it all. */
      document?: string;
    }
  | { ran: false; refusal: RunRefusal; message: RunMessage };

/** The key the request limit counts a user's runs under, whichever chat they came from. */
export function rateKey(userId: number): string {
  return `run:${userId}`;
}

/**
 * Runs one user's code under the limits that apply to chats (the length of the
 * code, the request rate, the sandbox time) and says what to answer. Private
 * messages and group commands share it, so a user cannot get more by mixing them.
 */
export function createRunner(options: RunnerOptions) {
  return async function run(userId: number, code: string): Promise<RunOutcome> {
    const refuse = (refusal: RunRefusal, text: string): RunOutcome => ({
      ran: false,
      refusal,
      message: formatRejectionMessage(text),
    });

    const rateLimit = options.rateLimiter.consume(rateKey(userId), options.rateLimitPolicy);
    if (!rateLimit.allowed) {
      return refuse("rate-limit", `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`);
    }

    if (!isCodeLengthAllowed(code, options.maxCodeLength)) {
      return refuse("too-long", `Code exceeds the ${options.maxCodeLength}-character limit.`);
    }

    const budgetKey = `user:${userId}`;
    const budget = options.timeBudget.check(budgetKey, options.timeBudgetPolicy);
    if (!budget.allowed) {
      return refuse(
        "run-time",
        `Your code has used up its run time for now. Try again in ${Math.ceil(budget.retryAfterMs / 1000)}s.`,
      );
    }

    const execution = await options.sandbox.execute(code);
    options.timeBudget.record(budgetKey, execution.durationMs, options.timeBudgetPolicy);
    if (execution.timedOut) {
      options.rateLimiter.charge(rateKey(userId), options.rateLimitPolicy, TIMEOUT_PENALTY_REQUESTS);
    }

    const message = formatExecutionMessage(execution, code);
    return {
      ran: true,
      message,
      document: message.cut ? formatExecutionDocument(execution, code) : undefined,
    };
  };
}
