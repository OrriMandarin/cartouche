"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { CardEditor } from "@/components/editor/CardEditor";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; card: CardView }
  | { kind: "not-found" }
  | { kind: "error"; error: unknown };

function EditorLoader({ id }: { id: string }) {
  const t = useTranslations();
  const api = useApi();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: State;
      try {
        const { data } = await api.GET("/api/cards/{id}", { params: { path: { id } } });
        next = data ? { kind: "ready", card: data } : { kind: "error", error: new Error("empty response") };
      } catch (error) {
        // A card that does not exist and the card of someone else look the same (ACC-017).
        next = error instanceof ApiError && error.status === 404 ? { kind: "not-found" } : { kind: "error", error };
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  switch (state.kind) {
    case "loading":
      return (
        <p data-testid="editor-loading" className="text-muted-foreground py-6 text-center">
          {t("editor.loading")}
        </p>
      );
    case "not-found":
      return (
        <p data-testid="card-not-found" className="text-muted-foreground py-10 text-center text-lg">
          {t("publicCard.notFound")}
        </p>
      );
    case "error":
      return <ErrorNotice error={state.error} />;
    case "ready":
      return <CardEditor card={state.card} />;
  }
}

/** spec: EDI-003. The editor of one card of the signed-in user. */
export default function EditCardPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <AccountGate>
      <EditorLoader id={id} />
    </AccountGate>
  );
}
