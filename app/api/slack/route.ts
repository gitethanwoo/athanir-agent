import "@/lib/chat-session-handlers";
import { after } from "next/server";
import { bot } from "@/lib/bot";

export async function POST(request: Request) {
  return bot.webhooks.slack(request, {
    waitUntil: (promise) => after(() => promise),
  });
}
