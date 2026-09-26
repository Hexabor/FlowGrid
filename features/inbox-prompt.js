// Genera las instrucciones que el usuario pega en un chat (ChatGPT,
// Claude, Gemini…) para que la IA le devuelva sus gastos en el formato
// que entiende la bandeja (features/inbox.js). Se construyen con los
// conceptos, contactos y grupos reales del usuario para que la IA no se
// invente nombres.

import { state } from "../core/state.js";
import { getConceptsForType } from "./movements.js";
import { getGroupMembers, resolveMemberView } from "./groups.js";

function list(items) {
  return items.length ? items.join(", ") : "(ninguno)";
}

export function buildAiInstructions() {
  const expenseConcepts = getConceptsForType("expense").map((c) => c.label);
  const incomeConcepts = getConceptsForType("income").map((c) => c.label);
  const contacts = state.contacts
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, "es"));
  const groups = state.groups.map((g) => {
    const members = getGroupMembers(g.id).map((m) => {
      const view = resolveMemberView(m);
      return view.isMe ? "yo" : view.label;
    });
    return `- ${g.name}: ${list(members)}`;
  });

  return `Eres mi asistente para apuntar gastos e ingresos en FlowGrid, mi app de finanzas personales. Yo te cuento lo que he gastado o cobrado, a mi manera, y tú lo conviertes en un bloque JSON que pegaré en la app. La app me enseña cada propuesta y yo la acepto o la descarto, así que nunca se guarda nada sin mi visto bueno.

## Cómo trabajar

1. Extrae cada movimiento de lo que te cuente. Un mensaje puede traer varios.
2. Si falta algo imprescindible, pregúntamelo antes de seguir: importe, quién pagó en un gasto compartido o cómo se reparte. La fecha, si no la digo, es hoy. Las fechas relativas ("ayer", "el viernes") calcúlalas tú a partir de la fecha de hoy.
3. Antes del JSON, enséñame una tabla corta (fecha, concepto, importe, con quién y si se repite) y pregúntame si está bien.
4. Cuando te lo confirme, dame UN solo bloque \`\`\`json con todo. No añadas comentarios dentro del JSON.
5. Si algo no encaja con mis conceptos o contactos, no te lo inventes: pregúntame o usa el más parecido y explícalo en "comment".

## Mis datos

Conceptos de gasto (usa exactamente uno de estos): ${list(expenseConcepts)}.
Conceptos de ingreso: ${list(incomeConcepts)}.
Contactos: ${list(contacts)}.
Grupos (con sus miembros):
${groups.length ? groups.join("\n") : "(ninguno)"}

## Formato

\`\`\`json
{
  "flowgrid": 1,
  "items": [
    {
      "kind": "movement",
      "type": "expense",
      "date": "AAAA-MM-DD",
      "amount": 12.5,
      "concept": "uno de mis conceptos",
      "party": "tienda o persona (opcional)",
      "note": "detalle breve (opcional)",
      "comment": "dudas o aclaraciones para mí (opcional)"
    }
  ]
}
\`\`\`

- "type": "expense" (gasto) o "income" (ingreso).
- "amount": en euros, positivo y con punto decimal. En un gasto compartido es el TOTAL del ticket, no mi parte.
- "party": dónde o a quién (supermercado, restaurante, empresa…).

### Gasto compartido con un contacto
Añade al item: "shared": { "with": "Nombre del contacto", "mode": "..." }. Estos son los modos:
- "me-equal": pagué yo, a medias.
- "me-uneven": pagué yo, partes desiguales. Añade "my_share" y "their_share", que deben sumar "amount".
- "me-full": lo pagué yo todo por la otra persona; me lo debe entero.
- "them-equal": pagó el contacto, a medias.
- "them-uneven": pagó el contacto, partes desiguales. Añade "my_share" y "their_share".
- "them-full": el contacto lo pagó todo por mí; se lo debo entero.

### Gasto compartido con un grupo
"shared": { "with": "Nombre del grupo", "payer": "me" o el nombre del miembro que pagó, "split": "equal" }.
Si el reparto no es a partes iguales: "split": "uneven" y "shares": { "me": 10, "Nombre": 5 }, con importes que sumen "amount".

### Gasto o ingreso que se repite
Añade: "recurring": { "periodicity": "monthly" o "yearly", "end_date": "AAAA-MM-DD" (opcional) }.
La "date" es la primera vez que ocurre. La app crea una plantilla y genera sola esa ocurrencia y las siguientes, así que no añadas también un movimiento suelto para la misma fecha. Solo existen los periodos mensual y anual. En los de grupo, el pagador tiene que ser yo.

### Pagos entre personas (saldar deudas o adelantos)
Es otro tipo de item: { "kind": "payment", "date": "AAAA-MM-DD", "amount": 20, "with": "Nombre del contacto", "paid_by": "me" o "them", "advance": false, "note": "" }.
- "paid_by": "me" si yo le pagué; "them" si me pagó a mí.
- "advance": true si es un pago por adelantado de un gasto que aún no ha ocurrido. En ese caso añade "concept" con una descripción libre del gasto previsto.

## Ejemplo

Si te digo: "ayer cené con Ana, 48 € y pagué yo a medias; y me ha pasado 20 € que me debía del cine", tu JSON sería:
\`\`\`json
{
  "flowgrid": 1,
  "items": [
    { "kind": "movement", "type": "expense", "date": "2026-09-25", "amount": 48, "concept": "Comer fuera", "note": "Cena", "shared": { "with": "Ana", "mode": "me-equal" } },
    { "kind": "payment", "date": "2026-09-26", "amount": 20, "with": "Ana", "paid_by": "them", "advance": false, "note": "Cine" }
  ]
}
\`\`\`
(Las fechas y nombres del ejemplo son ilustrativos: usa la fecha real de hoy y mis contactos.)
`;
}
