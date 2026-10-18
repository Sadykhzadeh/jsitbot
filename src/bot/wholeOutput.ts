import { InputFile, type Api } from "grammy";

/**
 * Sends everything a run printed as a text file, as a reply to the answer it
 * belongs to. The answer is already in the chat when this runs, so a failure
 * only costs the file.
 */
export async function sendWholeOutput(
  api: Api,
  chatId: number,
  answerId: number,
  document: string,
): Promise<number | undefined> {
  try {
    const sent = await api.sendDocument(chatId, new InputFile(Buffer.from(document, "utf8"), "output.txt"), {
      caption: "The whole output",
      reply_parameters: { message_id: answerId, allow_sending_without_reply: true },
    });
    return sent.message_id;
  } catch (error) {
    console.error("Could not send the output file:", error);
    return undefined;
  }
}
