function serializeForGuest(valueName: string): string {
  return `(() => {
    const value = ${valueName};
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "bigint") return value.toString() + "n";
    if (typeof value === "function") return "[Function]";
    if (typeof value === "symbol") return value.toString();
    if (value && typeof value === "object") {
      const maybeMessage = "message" in value ? value.message : undefined;
      const maybeName = "name" in value ? value.name : undefined;
      if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
        return typeof maybeName === "string" && maybeName.length > 0
          ? maybeName + ": " + maybeMessage
          : maybeMessage;
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      try {
        return String(value);
      } catch {
        return "[Unserializable value]";
      }
    }
  })()`;
}

function createWrappedBody(code: string, isExpression: boolean): string {
  const body = isExpression
    ? `return (${code});`
    : `${code}`;

  return `
globalThis.console = Object.freeze({
  log: (...args) => globalThis.__hostLog(...args),
});
Object.freeze(globalThis.console);

(async () => {
  try {
    const __value = await (async () => {
      ${body}
    })();
    return { ok: true, value: ${serializeForGuest("__value")} };
  } catch (error) {
    return { ok: false, error: ${serializeForGuest("error")} };
  }
})()
`;
}

export function buildExpressionWrapper(code: string): string {
  return createWrappedBody(code, true);
}

export function buildStatementWrapper(code: string): string {
  return createWrappedBody(code, false);
}
