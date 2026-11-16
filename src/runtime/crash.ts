import { describeFailure } from "./logError";

/**
 * Ends the process when an error reaches the top without a handler. It logs one
 * line and exits with status 1, so the service manager starts the bot again.
 * Left to the runtime, the error object is printed whole, and an error from a
 * failed call to Telegram prints the address it was sent to, which has the token.
 */
export function listenForCrashes(
  secrets: readonly string[],
  log: (line: string) => void = (line) => console.error(line),
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let crashed = false;

  const crash = (error: unknown) => {
    if (crashed) {
      return;
    }
    crashed = true;

    log(`Crashed: ${describeFailure(error, secrets)}`);
    exit(1);
  };

  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
}
