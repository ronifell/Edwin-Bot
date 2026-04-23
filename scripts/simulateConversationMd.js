const { handleInbound } = require("../src/botService");
const { resetStore } = require("../src/storage");

async function runCase(testCase) {
  resetStore();
  const replies = [];
  const options = {
    sendMessage: async () => {},
    onBotMessage: (text) => replies.push(text),
  };

  if (testCase.steps) {
    const phone = `57${String(testCase.id).padStart(10, "0")}`;
    const results = [];
    for (const step of testCase.steps) {
      // eslint-disable-next-line no-await-in-loop
      const result = await handleInbound({ message: step, phone, senderName: "Test" }, options);
      results.push(result);
    }
    const ok = evaluate(testCase.expected, replies, results[results.length - 1]);
    return { id: testCase.id, title: testCase.title, ok, replies, result: results[results.length - 1] };
  }

  const result = await handleInbound(
    { message: testCase.input, phone: `57${String(testCase.id).padStart(10, "0")}`, senderName: "Test" },
    options
  );
  const ok = evaluate(testCase.expected, replies, result);
  return { id: testCase.id, title: testCase.title, ok, replies, result };
}

function evaluate(expected, replies, result) {
  if (expected.responseType && result.responseType !== expected.responseType) return false;
  if (expected.includesAny && !expected.includesAny.some((token) => replies.join(" ").toLowerCase().includes(token))) {
    return false;
  }
  if (
    expected.includesAll &&
    !expected.includesAll.every((token) => replies.join(" ").toLowerCase().includes(token))
  ) {
    return false;
  }
  return true;
}

async function main() {
  const tests = [
    {
      id: 1,
      title: "Convo 1 homicide + child minor",
      input: "Y el ase 7años lo mataron y la nina es menor",
      expected: { responseType: "purple_clarification", includesAny: ["quien fallecio", "cotizaba"] },
    },
    {
      id: 2,
      title: "Convo 2 spouse + worked",
      input: "mi esposo fallecio y trabajo en empresa",
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 3,
      title: "Convo 3 greeting",
      input: "Buen dia como esta",
      expected: { responseType: "greeting", includesAny: ["me encuentro bien"] },
    },
    {
      id: 4,
      title: "Convo 4 companion and kids",
      input: "mi companero fallecio teniamos hijos menores",
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 5,
      title: "Convo 8 ID + death date followup",
      steps: ["hola quisiera saber si soy beneficiaria", "cc 1.077.633.310", "fecha de fallecimiento 17.02.2024"],
      expected: { responseType: "data_collected", includesAny: ["muchas gracias por la informacion"] },
    },
    {
      id: 6,
      title: "Convo 9 child with colpensiones",
      input: "mi hijo fallecio hace cinco anos cotizaba en colpensiones",
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 7,
      title: "Convo 11 docs needed",
      input: "que documentos necesito para saber si soy beneficiario",
      expected: { responseType: "docs_info", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 8,
      title: "Convo 15 denied + other marriage",
      input: "mi companero murio tenia 1200 semanas pero soy casada con otra persona y me negaron la pension",
      expected: { responseType: "yellow_questions", includesAny: ["por que le negaron", "cuando fallecio"] },
    },
    {
      id: 9,
      title: "Convo 19 homicide + ask advice",
      input: "mi companero lo asesinaron hace 2 anos y quisiera asesoria",
      expected: { responseType: "purple_clarification", includesAny: ["quien fallecio", "cotizaba"] },
    },
    {
      id: 10,
      title: "Convo 24 denied pension yellow",
      input: "me negaron la pension de mi companero fallecio hace 4 anos convivimos 11 anos",
      expected: { responseType: "yellow_questions", includesAny: ["por que le negaron", "quien fallecio"] },
    },
    {
      id: 11,
      title: "Convo 26 unmarried partner",
      input: "como reclamar pension de mi pareja fallecida vivi 7 anos con el no nos casamos",
      expected: { responseType: "purple_clarification", includesAny: ["quien fallecio", "cotizaba"] },
    },
    {
      id: 12,
      title: "Convo 28 mother died long ago",
      input: "mi madre fallecio hace 6 anos quiero reclamar para mi padre",
      expected: { responseType: "purple_clarification", includesAny: ["quien fallecio", "cotizaba"] },
    },
    {
      id: 13,
      title: "Convo 29 father dead uncertain cotization",
      input: "mi padre tiene 8 anos de muerto no sabemos si cotizo pension",
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 14,
      title: "Convo 32 complete data in one message",
      input: "CC 77181282 fallecio el 24 de diciembre de 2008",
      expected: { responseType: "data_collected", includesAny: ["estare consultando su caso"] },
    },
    {
      id: 15,
      title: "Convo 34 own retirement should be red",
      input: "yo si cotice tengo 57 anos y quiero saber mi pension",
      expected: { responseType: "closed_red", includesAny: ["no manejamos ese tipo de casos"] },
    },
    {
      id: 16,
      title: "Convo 46 how are you + death context",
      steps: [
        "hola como estas",
        "mi esposo murio hace un mes muerte natural tenia colpensiones cotizaba ahi tengo hijos",
      ],
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 17,
      title: "Convo 48 denied pension worked",
      input: "perdi a mi esposo y negaron la pension trabajaba en empresa",
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 18,
      title: "Convo 49 long child case",
      input: "mi hijo fallecio y cotizaba en colpensiones no tenia esposa dejo dos ninas pequenas",
      expected: { responseType: "green_request_data", includesAll: ["cedula", "fecha exacta"] },
    },
    {
      id: 19,
      title: "Red teachers",
      input: "soy docente del magisterio y quiero pension",
      expected: { responseType: "closed_red", includesAny: ["no manejamos ese tipo de casos"] },
    },
    {
      id: 20,
      title: "Victim related clarification",
      input: "soy victima y desplazada",
      expected: { responseType: "victim_clarification", includesAny: ["directamente relacionado"] },
    },
  ];

  const results = [];
  for (const t of tests) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runCase(t));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`conversation.md simulation: ${passed}/${results.length} passed, ${failed} failed`);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.title}`);
    if (!r.ok) {
      console.log(`  responseType: ${r.result.responseType}`);
      console.log(`  replies: ${JSON.stringify(r.replies)}`);
    }
  }
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
