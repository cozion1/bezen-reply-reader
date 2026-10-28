import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Em, Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Strong, Text } from "@forge/react";
import { invoke } from "@forge/bridge";

const VERDICT = { pass: "success", rejected: "removed", escalated: "moved" };
const SEND = { auto: "a bot may answer", human: "a human must answer", none: "do not answer" };

function Entry({ e, onReview }) {
  const r = e.reading;
  return (
    <Box padding="space.150" backgroundColor="color.background.neutral.subtle">
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={VERDICT[e.verdict]}>critic: {e.verdict}</Lozenge>
          <Lozenge>{r.state}</Lozenge>
          <Text size="small">{e.at.slice(0, 16).replace("T", " ")}</Text>
        </Inline>
        {e.verdict === "rejected" ? (
          <Text>Rejected: {e.problem}</Text>
        ) : (
          <Stack space="space.075">
            <Text><Strong>Protecting:</Strong> {r.protecting}</Text>
            <Text><Strong>Their words:</Strong> <Em>"{r.evidence}"</Em></Text>
            <Text><Strong>Do not:</Strong> {r.dont}</Text>
            <Text><Strong>Who answers:</Strong> {SEND[r.send] || r.send}</Text>
            {r.message ? <Text><Strong>Next message:</Strong> {r.message}</Text> : null}
            {e.verdict === "escalated" ? <Text>The reader failed twice: {e.problem}</Text> : null}
            {e.human ? (
              <Lozenge appearance={e.human === "confirmed" ? "success" : "removed"}>{e.human}</Lozenge>
            ) : (
              <Inline space="space.100">
                <Button appearance="primary" onClick={() => onReview(e.id, "confirm")}>Confirm reading</Button>
                <Button onClick={() => onReview(e.id, "reject")}>Wrong reading</Button>
              </Inline>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => invoke("getLedger").then(setData).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  const onReview = async (id, decision) => {
    await invoke("review", { id, decision });
    load();
  };

  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  if (!data) return <Spinner />;
  return (
    <Stack space="space.200">
      <Text>
        Latest reply from <Strong>{data.reply.author}</Strong>: <Em>"{data.reply.text.slice(0, 280)}"</Em>
      </Text>
      {data.entries.length === 0 ? (
        <SectionMessage>
          <Text>No reading yet. Open Rovo chat and ask the BEZEN Reply Reader to read this request.</Text>
        </SectionMessage>
      ) : (
        <Stack space="space.150">
          <Heading size="small">Readings and critic decisions</Heading>
          {data.entries.map((e) => <Entry key={e.id} e={e} onReview={onReview} />)}
        </Stack>
      )}
      <Button appearance="subtle" onClick={load}>Refresh</Button>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
