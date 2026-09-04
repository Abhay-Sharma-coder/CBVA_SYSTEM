"use client";

/**
 * The on-behalf-of picker.
 *
 * A searchable combobox rather than a select, because the bookable roster is 94
 * people and a native select of 94 names is unusable — but built from an input
 * and a listbox by hand, following the ARIA combobox pattern, because a
 * div-with-a-click-handler is how a picker stops working for anybody using a
 * keyboard.
 *
 * The list is fetched from /api/people, which is gated on the SAME rule as the
 * write (`canBookOnBehalf`) — somebody who may not book for a colleague cannot
 * enumerate the roster either.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, X } from "lucide-react";

import { Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface Person {
  id: string;
  displayName: string;
  email: string;
  grade: string;
  team: string | null;
}

const GRADE_LABELS: Record<string, string> = {
  article: "Article",
  assistant_manager: "Assistant Manager",
  manager: "Manager",
  director: "Director",
  partner: "Partner",
  admin_staff: "Admin",
};

async function fetchPeople(query: string): Promise<{ people: Person[] }> {
  const res = await fetch(`/api/people?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Could not load the staff list.");
  return res.json();
}

export function PersonPicker({
  value,
  onChange,
  disabled,
}: {
  value: Person | null;
  onChange: (person: Person | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["people", query],
    queryFn: () => fetchPeople(query),
    enabled: !disabled,
    staleTime: 60_000,
  });

  const people = useMemo(() => data?.people ?? [], [data]);

  // Clicking away closes the list. Focus leaving does too, via onBlur below,
  // but a click on the page background never blurs the input on Safari.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function choose(person: Person) {
    onChange(person);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => Math.min(people.length - 1, Math.max(0, i + delta)));
      return;
    }
    if (event.key === "Enter" && open && people[activeIndex]) {
      event.preventDefault();
      choose(people[activeIndex]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${inputId}-chosen`}>Colleague</Label>
        <div
          id={`${inputId}-chosen`}
          className="flex items-center justify-between gap-3 rounded-sm border border-hairline bg-surface-sunken px-3 py-2"
        >
          <span className="text-sm text-ink">
            {value.displayName}
            <span className="ml-2 text-xs text-ink-subtle">
              {GRADE_LABELS[value.grade] ?? value.grade}
              {value.team ? ` · ${value.team}` : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-sm p-1 text-ink-subtle hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            aria-label={`Choose somebody other than ${value.displayName}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" ref={wrapper}>
      <Label htmlFor={inputId}>Colleague</Label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && people[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by name or email"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="pr-8"
        />
        <ChevronDown
          className="pointer-events-none absolute top-2.5 right-2.5 size-4 text-ink-subtle"
          aria-hidden="true"
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Bookable colleagues"
          className="max-h-56 overflow-y-auto rounded-sm border border-hairline bg-surface"
        >
          {isLoading ? (
            <li className="px-3 py-2 text-sm text-ink-subtle">Loading…</li>
          ) : people.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-subtle">
              Nobody bookable matches “{query}”.
            </li>
          ) : (
            people.map((person, index) => (
              <li
                key={person.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onPointerDown={(e) => {
                  // pointerdown, not click: the input's blur would close the
                  // list before a click ever landed.
                  e.preventDefault();
                  choose(person);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm",
                  index === activeIndex ? "bg-navy-tint text-ink" : "text-ink",
                )}
              >
                <span>
                  {person.displayName}
                  <span className="ml-2 text-xs text-ink-subtle">
                    {GRADE_LABELS[person.grade] ?? person.grade}
                    {person.team ? ` · ${person.team}` : ""}
                  </span>
                </span>
                {index === activeIndex ? (
                  <Check className="size-3.5 text-navy" aria-hidden="true" />
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
