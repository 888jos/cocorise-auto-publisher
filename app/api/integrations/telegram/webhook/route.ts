import { NextResponse } from "next/server";
import { getTelegramConfig, sendTelegramMessage } from "@/lib/services/telegram";
import { telegramCommandReply } from "@/lib/services/telegramCommands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

export async function POST(request: Request) {
  const config = getTelegramConfig();
  if (!config.webhookSecret || request.headers.get("x-telegram-bot-api-secret-token") !== config.webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const text = update?.message?.text?.trim();
  const chatId = update?.message?.chat?.id?.toString();
  if (!text || !chatId || chatId !== config.chatId) return NextResponse.json({ ok: true });

  try {
    await sendTelegramMessage(await telegramCommandReply(text), { chatId });
  } catch (error) {
    console.error("Telegram command failed", error);
  }
  return NextResponse.json({ ok: true });
}
