"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  ItineraryItem,
  createItineraryItem,
  deleteItineraryItem,
  reorderItinerary,
  updateItineraryItem,
} from "@/lib/trips";

/** Split items into one array per day, clamping stray days into the last column. */
function toColumns(items: ItineraryItem[], dayCount: number): ItineraryItem[][] {
  const cols: ItineraryItem[][] = Array.from({ length: dayCount }, () => []);
  for (const item of items) {
    const day = Math.min(Math.max(item.day_index, 0), dayCount - 1);
    cols[day].push(item);
  }
  for (const col of cols) col.sort((a, b) => a.position - b.position);
  return cols;
}

interface BoardProps {
  tripId: number;
  dayLabels: string[];
  items: ItineraryItem[];
  onItemsChange: (items: ItineraryItem[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  onError: (message: string) => void;
}

export default function ItineraryBoard({
  tripId,
  dayLabels,
  items,
  onItemsChange,
  onDraggingChange,
  onError,
}: BoardProps) {
  const sensors = useSensors(
    // A small drag threshold so clicking the edit/delete buttons still works.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const columns = toColumns(items, dayLabels.length);

  function handleDragStart() {
    onDraggingChange(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    onDraggingChange(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cols = toColumns(items, dayLabels.length);
    let srcDay = -1;
    let srcIdx = -1;
    cols.forEach((col, d) =>
      col.forEach((it, i) => {
        if (it.id === active.id) {
          srcDay = d;
          srcIdx = i;
        }
      }),
    );
    if (srcDay < 0) return;

    let dstDay: number | undefined;
    let dstIdx = 0;
    const overId = String(over.id);
    if (overId.startsWith("day-")) {
      dstDay = Number(overId.slice(4));
      dstIdx = cols[dstDay].length;
    } else {
      cols.forEach((col, d) =>
        col.forEach((it, i) => {
          if (it.id === over.id) {
            dstDay = d;
            dstIdx = i;
          }
        }),
      );
    }
    if (dstDay === undefined) return;

    const [moved] = cols[srcDay].splice(srcIdx, 1);
    if (srcDay === dstDay && srcIdx < dstIdx) dstIdx -= 1;
    cols[dstDay].splice(dstIdx, 0, moved);

    const next: ItineraryItem[] = [];
    cols.forEach((col, d) =>
      col.forEach((it, i) =>
        next.push({ ...it, day_index: d, position: i }),
      ),
    );
    onItemsChange(next); // optimistic
    reorderItinerary(
      tripId,
      next.map(({ id, day_index, position }) => ({ id, day_index, position })),
    ).catch(() => onError("Couldn't save the new order — refresh and retry."));
  }

  async function handleAdd(day: number, title: string) {
    const position = columns[day].length;
    try {
      const item = await createItineraryItem({
        trip: tripId,
        day_index: day,
        position,
        title,
      });
      onItemsChange([...items, item]);
    } catch {
      onError("Couldn't add that item.");
    }
  }

  async function handleUpdate(id: number, patch: { title?: string; notes?: string }) {
    try {
      const updated = await updateItineraryItem(id, patch);
      onItemsChange(items.map((it) => (it.id === id ? updated : it)));
    } catch {
      onError("Couldn't save your change.");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteItineraryItem(id);
      onItemsChange(items.filter((it) => it.id !== id));
    } catch {
      onError("Couldn't remove that item.");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((col, day) => (
          <DayColumn
            key={day}
            day={day}
            label={dayLabels[day]}
            items={col}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </DndContext>
  );
}

function DayColumn({
  day,
  label,
  items,
  onAdd,
  onUpdate,
  onDelete,
}: {
  day: number;
  label: string;
  items: ItineraryItem[];
  onAdd: (day: number, title: string) => void;
  onUpdate: (id: number, patch: { title?: string; notes?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day}` });
  const [newTitle, setNewTitle] = useState("");

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    onAdd(day, title);
    setNewTitle("");
  }

  return (
    <section
      ref={setNodeRef}
      className={`flex flex-col gap-2 rounded-2xl border p-3 transition ${
        isOver
          ? "border-brand-teal bg-surface-alt ring-2 ring-brand-teal/30"
          : "border-line bg-surface"
      }`}
    >
      <h3 className="font-serif text-[15px] text-brand-teal">
        Day {day + 1} · {label}
      </h3>

      <SortableContext
        items={items.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex min-h-6 flex-col gap-2">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </SortableContext>

      <form
        onSubmit={submitNew}
        className="mt-1 flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-[#d5d9d0] p-1.5"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="+ Add item…"
          aria-label={`Add an item to ${label}`}
          className="w-full bg-transparent px-1 text-sm text-[#1c2b2b] outline-none placeholder:text-[#a6aca4]"
        />
        <button
          type="submit"
          disabled={!newTitle.trim()}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-teal text-base font-bold text-background transition hover:brightness-90 disabled:opacity-40"
          aria-label="Add"
        >
          +
        </button>
      </form>
    </section>
  );
}

function ItemCard({
  item,
  onUpdate,
  onDelete,
}: {
  item: ItineraryItem;
  onUpdate: (id: number, patch: { title?: string; notes?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function save(e: React.FormEvent) {
    e.preventDefault();
    onUpdate(item.id, { title: title.trim() || item.title, notes });
    setEditing(false);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="rounded-[10px] border border-line bg-white p-2.5 text-sm transition hover:border-brand-teal/40"
    >
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Item title"
            className="w-full rounded-md border border-line-input bg-white px-2 py-1 outline-none focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            aria-label="Item notes"
            rows={2}
            className="w-full rounded-md border border-line-input bg-white px-2 py-1 text-xs outline-none focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-brand-teal px-3 py-1 text-xs font-bold text-background"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(item.title);
                setNotes(item.notes);
                setEditing(false);
              }}
              className="rounded-full border border-[#d5d9d0] px-3 py-1 text-xs font-semibold text-brand-teal"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="mt-0.5 cursor-grab touch-none text-text-subtle/60"
          >
            ⠿
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{item.title}</p>
            {item.notes && (
              <p className="whitespace-pre-wrap text-xs text-text-subtle">
                {item.notes}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit item"
              className="text-xs text-text-subtle hover:text-brand-teal"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              aria-label="Remove item"
              className="text-xs text-brand-coral-ink/80 hover:text-brand-coral-ink"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
