const hashText = (value = "") => [...String(value)].reduce((sum, char) => sum + char.charCodeAt(0), 0);

export function buildOutfit(items, context, variation = 0) {
  const choose = (category, salt = 0) => {
    const eligible = items.filter((item) => item.category === category);
    if (!eligible.length) return undefined;
    const preferred = eligible.filter((item) => !item.vibe || item.vibe === context.vibe);
    const choices = preferred.length ? preferred : eligible;
    return choices[(hashText(`${context.occasion}-${context.vibe}`) + variation + salt) % choices.length];
  };

  const hasSeparates = items.some((item) => item.category === "top") && items.some((item) => item.category === "bottom");
  const dress = (context.vibe === "Polished" || context.occasion === "Dinner" || !hasSeparates) ? choose("dress", 2) : undefined;
  const picks = dress ? [dress] : [choose("top", 0), choose("bottom", 1)];
  if (context.weather === "Cool") picks.push(choose("layer", 3));
  picks.push(choose("shoe", 4), choose("accessory", 5));
  const outfit = picks.filter(Boolean);
  if (!outfit.length) return null;

  const warmth = context.weather === "Cool" ? "A light layer keeps this comfortable in cooler weather." : context.weather === "Warm" ? "Breathable pieces keep the look easy in warm weather." : "A balanced combination for a mild day.";
  return {
    items: outfit,
    note: `${warmth} Styled for ${context.occasion.toLowerCase()} with a ${context.vibe.toLowerCase()} feel.`,
  };
}

export function getBudgetSummary(entries, budgets) {
  const spent = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const planned = Object.values(budgets).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const categories = Object.keys(budgets).map((category) => {
    const amount = entries.filter((entry) => entry.category === category).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const limit = Number(budgets[category] || 0);
    return { category, amount, limit, remaining: limit - amount, percent: limit > 0 ? Math.min(100, Math.round((amount / limit) * 100)) : 0 };
  });
  return { spent, planned, remaining: planned - spent, percent: planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : 0, categories };
}

export function filterScreenshots(items, query = "", category = "All") {
  const needle = String(query).trim().toLowerCase();
  return items.filter((item) => {
    const matchesCategory = category === "All" || item.category === category;
    const searchable = [item.name, item.category, item.note, ...(item.tags || [])].join(" ").toLowerCase();
    return matchesCategory && (!needle || searchable.includes(needle));
  });
}
