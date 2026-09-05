"use client";

import { useActionState, useRef } from "react";
import { MESSAGE_MAX_LENGTH } from "@/lib/messaging";
import { sendMessage, type MessageActionState } from "../actions";

const initialState: MessageActionState = {};

export default function MessageForm({ conversationId }: { conversationId: number }) {
  const action = sendMessage.bind(null, conversationId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await formAction(formData);
        formRef.current?.reset();
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-end gap-2.5">
        <textarea
          name="body"
          required
          rows={2}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder="Write a message…"
          className="flex-1 text-sm rounded-2xl border-[1.5px] border-line px-4 py-2.5 resize-none bg-surface"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
