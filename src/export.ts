import { db } from './db';

export async function exportJson() {
  const [feeding, diaper, sleep, poop, cry, attachment] = await Promise.all([
    db.feeding.toArray(),
    db.diaper.toArray(),
    db.sleep.toArray(),
    db.poop.toArray(),
    db.cry.toArray(),
    db.attachment.toArray()
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    feeding,
    diaper,
    sleep,
    poop,
    cry,
    attachment: attachment.map((item) => ({
      id: item.id,
      eventType: item.eventType,
      eventId: item.eventId,
      kind: item.kind,
      createdAt: item.createdAt,
      omitted: 'binary attachments are reserved for future zip export'
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `babylog-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
