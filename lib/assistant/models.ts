import { ready } from "@/lib/assistant/db";
import { choiceId, parseChoice } from "@/lib/assistant/modelRouter";
import { configuredModels } from "@/lib/assistant/llm";

/** The user's saved model choice ("auto" when none). Stored in elias_user_settings.data.model. */
export async function getModelChoice(userId: string) {
  const db = await ready();
  const row = (await db`select data from public.elias_user_settings where user_id = ${userId}`)[0];
  const data = (row?.data || {}) as Record<string, unknown>;
  return choiceId(parseChoice(data.model));
}

export async function setModelChoice(userId: string, raw: unknown) {
  const id = choiceId(parseChoice(raw));
  const db = await ready();
  await db`insert into public.elias_user_settings (user_id, data) values (${userId}, ${db.json({ model: id } as never)})
    on conflict (user_id) do update set data = public.elias_user_settings.data || excluded.data, updated_at = now()`;
  return id;
}

/** Picker options: the three modes, then every configured provider's usable models. */
export async function modelOptions() {
  const providers = await configuredModels();
  return {
    modes: [
      { id: "auto", label: "Auto", detail: "Picks fast or strong for each message" },
      { id: "fast", label: "Fast", detail: "Quick replies for plain chat" },
      { id: "strong", label: "Strong", detail: "Tools, long messages and files" },
    ],
    providers: providers.map((item) => ({ provider: item.provider, models: item.models.map((model) => ({ id: `${item.provider}/${model.id}`, model: model.id, vision: model.vision })) })),
  };
}
