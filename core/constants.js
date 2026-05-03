import { createSlug } from "./utils.js";

export const MOVEMENTS_KEY = "flowgrid.movements.v1";
export const SETTINGS_KEY = "flowgrid.settings.v1";
export const SHARED_KEY = "flowgrid.shared.v2";
export const CONTACTS_KEY = "flowgrid.contacts.v1";
export const RECURRING_TEMPLATES_KEY = "flowgrid.recurring.v1";
// Legacy key kept only for one-time migration on first boot after the
// person→contact rename. Safe to remove once all clients have migrated.
export const LEGACY_PEOPLE_KEY = "flowgrid.people.v1";

export const SHARED_MODES = {
  "me-equal": { paidBy: "me", split: "equal", label: "Tú pagaste, partes iguales" },
  "me-uneven": { paidBy: "me", split: "uneven", label: "Tú pagaste, partes desiguales" },
  "me-full": { paidBy: "me", split: "full", label: "Se te debe la cantidad total" },
  "them-equal": { paidBy: "them", split: "equal", label: "{name} pagó, partes iguales" },
  "them-uneven": { paidBy: "them", split: "uneven", label: "{name} pagó, partes desiguales" },
  "them-full": { paidBy: "them", split: "full", label: "A {name} le debes la cantidad total" },
};

export const defaultCategories = [
  { value: "supervivencia", label: "Supervivencia", color: "#b9ddf2", text: "#005f99" },
  { value: "ocio", label: "Ocio", color: "#ffc8a8", text: "#7a3200" },
  { value: "extra", label: "Extra", color: "#f7c4bd", text: "#ab1717" },
  { value: "formacion", label: "Formación", color: "#d6e5bd", text: "#4f6419" },
  { value: "perdido", label: "Perdido", color: "#d8dce2", text: "#424a54" },
  { value: "ingreso", label: "Ingreso", color: "#dfc0ef", text: "#6b2b87" },
  { value: "ahorro", label: "Ahorro", color: "#c6e4c4", text: "#175c2e" },
  // "Definir" es la categoría a la que caen los conceptos que aparecen
  // en gastos compartidos del partner pero que el usuario aún no tiene
  // catalogados en su propia lista. Color amarillo cálido para que se
  // distinga visualmente y el usuario sepa que necesita asignar
  // categoría real desde Configuración.
  { value: "definir", label: "Definir", color: "#fff1b8", text: "#7a5500" },
];

export const defaultConcepts = [
  ["Alquiler", "supervivencia"],
  ["Comer fuera", "supervivencia"],
  ["Compra", "supervivencia"],
  ["Fibra", "supervivencia"],
  ["Higiene y cuidados", "supervivencia"],
  ["Mobiliario/Utensilios", "supervivencia"],
  ["Reparaciones", "supervivencia"],
  ["Ropa", "supervivencia"],
  ["Salud", "supervivencia"],
  ["Suministros", "supervivencia"],
  ["Teléfono", "supervivencia"],
  ["Transporte Urbano", "supervivencia"],
  ["Cafetería/pub", "ocio"],
  ["Contenidos", "ocio"],
  ["Deporte", "ocio"],
  ["Gamer", "ocio"],
  ["Golosinas", "ocio"],
  ["Música", "ocio"],
  ["Vacaciones", "ocio"],
  ["Viajes", "ocio"],
  ["Coche", "extra"],
  ["Equipos", "extra"],
  ["Oficina", "extra"],
  ["Regalos", "extra"],
  ["Formación", "formacion"],
  ["Gastos académicos", "formacion"],
  ["IRPF", "extra"],
  ["Perdido", "perdido"],
  ["Salario", "ingreso"],
  ["Recuperados", "ingreso"],
  ["Renta", "extra"],
  ["Fondos indexados", "ahorro"],
  ["Cuenta remunerada", "ahorro"],
].map(([label, category]) => ({
  id: createSlug(label),
  label,
  category,
}));

export const seedMovements = [
  {
    id: "demo-borrame",
    type: "expense",
    date: "2026-04-30",
    concept: "Borra este movimiento",
    amount: 0.01,
    category: "perdido",
    party: "",
    recurrence: "",
    note: "Solo es una demo. Cuando lo borres, FlowGrid empieza vacio para ti.",
  },
];
