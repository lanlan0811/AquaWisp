export interface ServerSentEvent {
  readonly event: string | null;
  readonly data: string;
  readonly id: string | null;
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: string | null = null;
  let eventId: string | null = null;
  let dataLines: string[] = [];

  function flush(): ServerSentEvent | undefined {
    if (dataLines.length === 0) {
      eventName = null;
      return undefined;
    }
    const event = { event: eventName, data: dataLines.join("\n"), id: eventId };
    eventName = null;
    dataLines = [];
    return event;
  }

  try {
    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      streamDone = done;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");

      for (const line of lines) {
        if (line === "") {
          const event = flush();
          if (event !== undefined) {
            yield event;
          }
          continue;
        }
        if (line.startsWith(":")) {
          continue;
        }
        const separator = line.indexOf(":");
        const field = separator === -1 ? line : line.slice(0, separator);
        let fieldValue = separator === -1 ? "" : line.slice(separator + 1);
        if (fieldValue.startsWith(" ")) {
          fieldValue = fieldValue.slice(1);
        }
        if (field === "event") {
          eventName = fieldValue;
        } else if (field === "data") {
          dataLines.push(fieldValue);
        } else if (field === "id" && !fieldValue.includes("\0")) {
          eventId = fieldValue;
        }
      }

      if (done) {
        if (buffer !== "") {
          dataLines.push(buffer);
        }
        const event = flush();
        if (event !== undefined) {
          yield event;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
