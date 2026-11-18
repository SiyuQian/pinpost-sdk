import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import {
  PinpostClient,
  FEEDBACK_TYPES,
  type FeedbackType,
  type SubmitPayload,
  type SubmitResult,
} from "@pinpost/core";
import { Star } from "lucide-react-native";

export interface PinpostContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  submit: (payload: SubmitPayload) => Promise<SubmitResult>;
  identify: PinpostClient["identify"];
  setContext: PinpostClient["setContext"];
  resetUser: PinpostClient["resetUser"];
  client: PinpostClient;
}

const Ctx = createContext<PinpostContextValue | null>(null);

export function PinpostProvider(props: {
  writeKey: string;
  apiUrl?: string;
  environment?: string;
  children?: ReactNode;
}) {
  const { writeKey, apiUrl, environment, children } = props;
  const client = useMemo(
    () => new PinpostClient({ writeKey, apiUrl, environment }),
    [writeKey, apiUrl, environment],
  );
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo<PinpostContextValue>(
    () => ({
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      isOpen,
      submit: (p) => client.submit(p),
      identify: (u) => client.identify(u),
      setContext: (c) => client.setContext(c),
      resetUser: () => client.resetUser(),
      client,
    }),
    [client, isOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePinpost(): PinpostContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePinpost must be used within <PinpostProvider>");
  return ctx;
}

type Status = "idle" | "submitting" | "succeeded" | "failed";

export function FeedbackWidget() {
  const { isOpen, open, close, submit } = usePinpost();
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | undefined>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit() {
    setStatus("submitting");
    setError("");
    try {
      await submit({ type, message, rating });
      setStatus("succeeded");
      setMessage("");
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send feedback"
        onPress={open}
        style={{
          position: "absolute",
          bottom: 24,
          right: 20,
          backgroundColor: "#1f2937",
          borderRadius: 24,
          paddingVertical: 10,
          paddingHorizontal: 16,
        }}
      >
        <Text style={{ color: "#fff" }}>Feedback</Text>
      </Pressable>
      <Modal visible={isOpen} transparent animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: "#fff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              gap: 8,
            }}
          >
            <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "600" }}>
              Send feedback
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {FEEDBACK_TYPES.map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="button"
                  accessibilityState={{ selected: type === t }}
                  onPress={() => setType(t)}
                  style={{
                    borderWidth: 1,
                    borderColor: type === t ? "#1f2937" : "#d1d5db",
                    borderRadius: 16,
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text>{t}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Message"
              placeholder="What happened?"
              multiline
              numberOfLines={4}
              maxLength={10000}
              value={message}
              onChangeText={setMessage}
              style={{ borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 8, minHeight: 80 }}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={`Rating ${n}`}
                  accessibilityState={{ selected: rating === n }}
                  onPress={() => setRating(rating === n ? undefined : n)}
                >
                  <Star
                    size={20}
                    color="#f6b73c"
                    fill={rating && rating >= n ? "#f6b73c" : "none"}
                  />
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={status === "submitting" || !message}
              onPress={handleSubmit}
              style={{ backgroundColor: "#1f2937", borderRadius: 8, padding: 12, alignItems: "center" }}
            >
              <Text style={{ color: "#fff" }}>
                {status === "submitting" ? "Sending…" : "Send"}
              </Text>
            </Pressable>
            {status === "succeeded" && <Text accessibilityLiveRegion="polite">Thanks for your feedback!</Text>}
            {status === "failed" && <Text accessibilityLiveRegion="assertive">Failed: {error}</Text>}
            <Pressable accessibilityRole="button" onPress={close} style={{ alignItems: "center", padding: 8 }}>
              <Text>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

export * from "@pinpost/core";
