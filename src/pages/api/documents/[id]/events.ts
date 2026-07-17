import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canRead } from "@/lib/acl";
import { getDocumentForUser } from "@/lib/documents";
import {
  getPresenceSnapshot,
  subscribe,
  type RealtimeEvent,
} from "@/lib/realtime-bus";

export const config = {
  api: {
    bodyParser: false,
  },
};

function writeEvent(res: NextApiResponse, event: RealtimeEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  const flushable = res as NextApiResponse & { flush?: () => void };
  flushable.flush?.();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const id = String(req.query.id ?? "");
  if (!id) {
    return res.status(400).json({ error: "Document id is required" });
  }

  const document = await getDocumentForUser(id, user.id);
  if (!document || !canRead(document.role)) {
    return res.status(404).json({ error: "Document not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Do NOT force mode=viewing here — client heartbeats own the mode.
  // Just subscribe and send the current snapshot.
  writeEvent(res, {
    type: "presence_sync",
    peers: getPresenceSnapshot(id),
  });

  const onEvent = (event: RealtimeEvent) => {
    writeEvent(res, event);
  };

  const unsubscribe = subscribe(id, user.id, onEvent);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
      const flushable = res as NextApiResponse & { flush?: () => void };
      flushable.flush?.();
    } catch {
      clearInterval(heartbeat);
      unsubscribe();
    }
  }, 15_000);

  // Prevent socket idle timeout killing the stream
  req.socket.setTimeout(0);
  req.socket.setNoDelay?.(true);

  await new Promise<void>((resolve) => {
    const done = () => {
      clearInterval(heartbeat);
      unsubscribe();
      resolve();
    };
    req.on("close", done);
    req.on("aborted", done);
  });
}
