// Kezek — Telegram-бот: webhook от Telegram + подключение бота из админки.
// Деплой: supabase functions deploy tg --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import { callClaude, runAgent } from "./ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type TgResult = { ok: boolean; result?: any; description?: string };

async function tg(token: string, method: string, body: Record<string, unknown>): Promise<TgResult> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

async function getConfig(): Promise<{ token: string | null; secret: string }> {
  const { data, error } = await sb.rpc("tg_config");
  if (error) throw error;
  return data;
}

async function send(token: string, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return await tg(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
}

async function answerWithAi(token: string, businessId: string, chatId: number) {
  await tg(token, "sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    const r = await runAgent(sb, businessId, chatId);
    await send(token, chatId, r.text.slice(0, 4000));
    await sb.rpc("ai_save_reply", { p_business: businessId, p_chat: chatId, p_text: r.text, p_in: r.tokensIn, p_out: r.tokensOut });
  } catch (e) {
    console.error("ai", e);
    await send(token, chatId, "Извините, сейчас не получается ответить. Я передал ваш вопрос администратору — он ответит здесь.");
    await sb.rpc("ai_handoff", { p_business: businessId, p_chat: chatId, p_summary: "ассистент временно недоступен" });
  }
}

async function handleUpdate(token: string, update: any) {
  if (update.message?.chat?.id) {
    const msg = update.message;
    const chatId = msg.chat.id;
    if (msg.chat.type !== "private") return;
    const text = String(msg.text ?? msg.caption ?? "").trim();
    if (text.startsWith("/start")) {
      const payload = text.split(/\s+/)[1] ?? "";
      const { data, error } = await sb.rpc("tg_handle_start", { p_chat_id: chatId, p_payload: payload });
      if (error) return console.error("tg_handle_start", error);
      await send(token, chatId, data.text, { parse_mode: "HTML", ...(data.reply_markup ? { reply_markup: data.reply_markup } : {}) });
      return;
    }
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
    const { data, error } = await sb.rpc("tg_route_text", {
      p_chat: chatId, p_text: text, p_name: name || null, p_username: msg.from?.username ?? null,
    });
    if (error) return console.error("tg_route_text", error);
    if (data.mode === "reply") {
      await send(token, chatId, data.text, { parse_mode: "HTML", ...(data.reply_markup ? { reply_markup: data.reply_markup } : {}) });
    } else if (data.mode === "ai") {
      await answerWithAi(token, data.business_id, chatId);
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const { data, error } = await sb.rpc("tg_handle_callback", {
      p_chat_id: chatId ?? 0,
      p_data: String(cq.data ?? ""),
    });
    if (error) console.error("tg_handle_callback", error);
    await tg(token, "answerCallbackQuery", { callback_query_id: cq.id, text: data?.answer ?? "" });
    if (cq.message && chatId && (data?.reply_markup || data?.remove_buttons)) {
      await tg(token, "editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: cq.message.message_id,
        reply_markup: data.reply_markup ?? { inline_keyboard: [] },
      });
    }
    if (data?.text && chatId) {
      await tg(token, "sendMessage", { chat_id: chatId, text: data.text, parse_mode: "HTML" });
    }
  }
}

async function userId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  return error || !data?.user ? null : data.user.id;
}

async function requireAdmin(req: Request): Promise<string | null> {
  const id = await userId(req);
  if (!id) return null;
  const { data: adm } = await sb.from("platform_admins").select("user_id").eq("user_id", id).maybeSingle();
  return adm ? id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: true, service: "kezek-tg" });

  try {
    const cfg = await getConfig();

    // 1) Входящее обновление от Telegram
    const tgSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (tgSecret !== null) {
      if (!cfg.token || tgSecret !== cfg.secret) return json({ ok: false }, 401);
      const update = await req.json();
      const job = handleUpdate(cfg.token!, update).catch((e) => console.error("update", e));
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(job); else await job;
      return json({ ok: true });
    }

    const body = await req.json().catch(() => ({}));

    // 2) Проверка ИИ-ассистента владельцем из кабинета
    if (body.action === "ai_test") {
      const uid = await userId(req);
      if (!uid) return json({ error: "Войдите в кабинет" }, 401);
      const text = String(body.text ?? "").trim().slice(0, 2000);
      if (!text) return json({ error: "Напишите сообщение" }, 400);
      const { data: prep, error: pe } = await sb.rpc("ai_test_prepare", { p_user: uid, p_text: text, p_reset: !!body.reset });
      if (pe) return json({ error: pe.message }, 400);
      try {
        const r = await runAgent(sb, prep.business_id, 0, true);
        await sb.rpc("ai_save_reply", { p_business: prep.business_id, p_chat: 0, p_text: r.text, p_in: r.tokensIn, p_out: r.tokensOut });
        return json({ ok: true, reply: r.text, booked: !!r.booked, handoff: !!r.handoff });
      } catch (e) {
        return json({ error: String((e as Error)?.message ?? e) }, 502);
      }
    }

    // 3) Действия администратора платформы
    const adminId = await requireAdmin(req);
    if (!adminId) return json({ error: "Нет доступа: войдите как администратор" }, 403);

    if (body.action === "ai_ping") {
      const { data: p } = await sb.rpc("ai_platform");
      if (!p?.api_key) return json({ error: "Ключ ИИ не сохранён" }, 400);
      try {
        const j = await callClaude(p.api_key, { model: p.model, max_tokens: 20, messages: [{ role: "user", content: "Ответь одним словом: работает?" }] });
        return json({ ok: true, model: j.model, reply: j.content?.[0]?.text ?? "" });
      } catch (e) {
        return json({ error: String((e as Error)?.message ?? e) }, 400);
      }
    }

    if (body.action === "setup") {
      const token = String(body.token ?? "").trim();
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
        return json({ error: "Неверный формат токена. Скопируйте его из @BotFather целиком." }, 400);
      }
      const me = await tg(token, "getMe", {});
      if (!me.ok) return json({ error: "Telegram не принял токен: " + (me.description ?? "") }, 400);
      const hook = await tg(token, "setWebhook", {
        url: `${SUPABASE_URL}/functions/v1/tg`,
        secret_token: cfg.secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      if (!hook.ok) return json({ error: "Не удалось подключить webhook: " + (hook.description ?? "") }, 400);
      await tg(token, "setMyDescription", {
        description: "Помощник салонов и студий: напоминаю о записях за день и за 2 часа, отвечаю на вопросы и помогаю записаться. Подтвердить или отменить запись можно одной кнопкой.",
      });
      await tg(token, "setMyShortDescription", { short_description: "Напоминания о записях и ответы на вопросы" });
      const { error } = await sb.rpc("tg_save_bot", { p_token: token, p_username: me.result.username });
      if (error) throw error;
      return json({ ok: true, username: me.result.username });
    }

    if (body.action === "status") {
      if (!cfg.token) return json({ ok: true, connected: false });
      const info = await tg(cfg.token, "getWebhookInfo", {});
      return json({
        ok: true,
        connected: true,
        url_ok: info.result?.url === `${SUPABASE_URL}/functions/v1/tg`,
        pending: info.result?.pending_update_count ?? 0,
        last_error: info.result?.last_error_message ?? null,
      });
    }

    return json({ error: "Неизвестное действие" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
