import { NextResponse } from "next/server";
import { answerTelegramCallbackQuery, getTelegramConfig, sendTelegramMessage } from "@/lib/services/telegram";
import { telegramCallbackCommand, telegramCommandButtons, telegramCommandReply } from "@/lib/services/telegramCommands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: {
      chat?: { id?: number };
    };
  };
};

export async function POST(request: Request) {
  const config = getTelegramConfig();
  if (!config.webhookSecret || request.headers.get("x-telegram-bot-api-secret-token") !== config.webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const callbackId = update?.callback_query?.id;
  const callbackData = update?.callback_query?.data?.trim();
  const callbackChatId = update?.callback_query?.message?.chat?.id?.toString();
  if (callbackId && callbackData && callbackChatId === config.chatId) {
    const command = telegramCallbackCommand(callbackData);
    try {
      if (command) {
        await answerTelegramCallbackQuery(callbackId);
        await sendTelegramMessage(await telegramCommandReply(command), { chatId: callbackChatId, buttons: telegramCommandButtons(command) });
      } else {
        await answerTelegramCallbackQuery(callbackId, "Commande inconnue.");
      }
    } catch (error) {
      console.error("Telegram callback failed", error);
    }
    return NextResponse.json({ ok: true });
  }

  const text = update?.message?.text?.trim();
  const chatId = update?.message?.chat?.id?.toString();
  if (!text || !chatId || chatId !== config.chatId) return NextResponse.json({ ok: true });

  try {
    await sendTelegramMessage(await telegramCommandReply(text), { chatId, buttons: telegramCommandButtons(text) });
  } catch (error) {
    console.error("Telegram command failed", error);
  }
  return NextResponse.json({ ok: true });
}
