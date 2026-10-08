"use client";

import { useState } from "react";

/** Chip delle aree con suggerimenti dalle aree esistenti. Invio o virgola aggiunge. */
export default function AreaInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState("");
  const listId = `areas-${suggestions.length}`;
  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 bg-surface-2 border border-border rounded-full pl-2.5 pr-1 py-0.5 text-xs">
          {a}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== a))} className="text-fg-dim hover:text-fg px-1" aria-label={`Rimuovi ${a}`}>×</button>
        </span>
      ))}
      <input value={text} list={listId} placeholder="+ area"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); } }}
        onBlur={() => text && add(text)}
        className="bg-transparent border-b border-border focus:border-accent outline-none text-xs py-0.5 w-24" />
      <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
