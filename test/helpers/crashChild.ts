// Child process for test/crash.test.ts: installs the crash listener, then fails
// with an error whose message carries the token, the way a failed fetch does.
//
//   bun test/helpers/crashChild.ts throw|reject <token>
import { listenForCrashes } from "../../src/runtime/crash";

const [mode, secret] = process.argv.slice(2);

listenForCrashes([secret]);

const error = Object.assign(new Error(`request to https://api.telegram.org/bot${secret}/getUpdates failed`), {
  name: "FetchError",
});

setTimeout(() => {
  if (mode === "reject") {
    void Promise.reject(error);
  } else {
    throw error;
  }
}, 0);

setInterval(() => undefined, 1_000);
