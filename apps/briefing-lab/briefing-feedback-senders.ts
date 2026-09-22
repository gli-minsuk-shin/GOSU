type SavedItem = {
  id: string;
  kind?: string | undefined;
  readScope: string;
  mailSender?: string | undefined;
};
type LiveEmail = { id: string; kind: string; details: readonly string[] };

/**
 * The sender of a rated email, found by item id in the saved briefings and the current collection.
 * Ratings store only the item id and title, so this lets both new and earlier ratings of emails
 * count for their sender.
 */
export function feedbackSenderLookup(
  history: readonly { items: readonly SavedItem[] }[],
  current: readonly LiveEmail[] = [],
) {
  const senders = new Map<string, string>();
  for (const entry of history)
    for (const item of entry.items)
      if ((item.kind ?? (item.readScope.startsWith('mail') ? 'email' : 'papers')) === 'email')
        if (item.mailSender && !senders.has(item.id)) senders.set(item.id, item.mailSender);
  for (const item of current)
    if (item.kind === 'email' && item.details[0] && !senders.has(item.id))
      senders.set(item.id, item.details[0]);
  return (itemId: string) => senders.get(itemId);
}
