const { handleInbound } = require("../src/botService");
const { resetStore } = require("../src/storage");

async function runSingleMessageScenario({ id, text, expectedResponseType, expectedContains }) {
  resetStore();
  const replies = [];
  const result = await handleInbound(
    { message: text, phone: `57300000${id}`, senderName: "Test" },
    {
      sendMessage: async () => {},
      onBotMessage: (message) => replies.push(message),
    }
  );

  const checks = [];
  checks.push(result.responseType === expectedResponseType);
  for (const fragment of expectedContains || []) {
    checks.push(replies.some((r) => r.toLowerCase().includes(fragment.toLowerCase())));
  }

  return {
    id,
    ok: checks.every(Boolean),
    result,
    replies,
  };
}

async function runMultiStepScenario() {
  resetStore();
  const phone = "573000009999";
  const replies = [];
  const send = {
    sendMessage: async () => {},
    onBotMessage: (message) => replies.push(message),
  };

  const step1 = await handleInbound(
    { message: "Hola, mi esposo fallecio y cotizaba", phone, senderName: "Test" },
    send
  );
  const step2 = await handleInbound(
    { message: "CC 71932793 murio el 12 abril 2022", phone, senderName: "Test" },
    send
  );
  const step3 = await handleInbound({ message: "ok", phone, senderName: "Test" }, send);

  const ok =
    step1.responseType === "green_request_data" &&
    step2.responseType === "data_collected" &&
    step3.responseType === "already_in_review" &&
    replies.some((r) => r.toLowerCase().includes("estare consultando su caso")) &&
    replies.some((r) => r.toLowerCase().includes("ya tengo sus datos en revision"));

  return { id: "multi-step-review-guard", ok, result: { step1, step2, step3 }, replies };
}

async function main() {
  const scenarios = [
    {
      id: "green-01",
      text: "Mi esposo fallecio y trabajaba toda la vida",
      expectedResponseType: "green_request_data",
      expectedContains: ["cedula", "fecha exacta"],
    },
    {
      id: "yellow-01",
      text: "Me negaron la pension hace anos",
      expectedResponseType: "yellow_questions",
      expectedContains: ["quien fallecio", "cuando fallecio"],
    },
    {
      id: "red-01",
      text: "Soy docente y quiero saber mi pension",
      expectedResponseType: "closed_red",
      expectedContains: ["no manejamos ese tipo de casos"],
    },
    {
      id: "victim-01",
      text: "Soy victima y necesito ayuda",
      expectedResponseType: "victim_clarification",
      expectedContains: ["directamente relacionado"],
    },
    {
      id: "docs-01",
      text: "Que documentos necesito?",
      expectedResponseType: "docs_info",
      expectedContains: ["cedula", "fecha exacta"],
    },
    {
      id: "info-01",
      text: "Como funciona la pension?",
      expectedResponseType: "how_it_works_info",
      expectedContains: ["fallece", "trabajo o cotizo"],
    },
    {
      id: "greeting-01",
      text: "Hola, como esta?",
      expectedResponseType: "greeting",
      expectedContains: ["me encuentro bien"],
    },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runSingleMessageScenario(scenario));
  }
  results.push(await runMultiStepScenario());

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  console.log(`Simulation summary: ${passed}/${results.length} passed, ${failed} failed`);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} - ${r.id}`);
    if (!r.ok) {
      console.log("  response:", r.result);
      console.log("  replies:", r.replies);
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
