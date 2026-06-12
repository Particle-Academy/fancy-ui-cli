import type { RegistryIndex, RegistryItem } from "../src/registry.js";

const REGISTRY = "https://registry.test";

export const index: RegistryIndex = {
  $schema: "https://ui.particle.academy/schema/registry.json",
  name: "fancy-ui",
  homepage: "https://ui.particle.academy",
  items: [
    {
      name: "card",
      type: "registry:ui",
      title: "Card",
      description: "Container with header/body/footer.",
      package: "react-fancy",
      files: 2,
      url: "/r/card.json",
    },
    {
      name: "accordion",
      type: "registry:ui",
      title: "Accordion",
      description: "Stateful disclosure surface.",
      package: "react-fancy",
      files: 1,
      url: "/r/accordion.json",
    },
    {
      name: "flow-editor",
      type: "registry:ui",
      title: "FlowEditor",
      description: "Workflow canvas + executor.",
      package: "fancy-flow",
      files: 1,
      url: "/r/flow-editor.json",
    },
  ],
};

// `card` depends on the `cn` util registry item AND lucide-react (npm).
export const items: Record<string, RegistryItem> = {
  card: {
    name: "card",
    type: "registry:ui",
    title: "Card",
    description: "Container with header/body/footer.",
    package: "react-fancy",
    dependencies: ["clsx", "tailwind-merge"],
    registryDependencies: ["cn-util"],
    files: [
      {
        path: "components/fancy/card/Card.tsx",
        target: "components/fancy/card/Card.tsx",
        type: "registry:ui",
        content: "export const Card = () => null;\n",
      },
      {
        path: "components/fancy/card/index.ts",
        target: "components/fancy/card/index.ts",
        type: "registry:ui",
        content: "export * from './Card';\n",
      },
    ],
  },
  "cn-util": {
    name: "cn-util",
    type: "registry:lib",
    title: "cn",
    description: "Class merge helper.",
    package: "react-fancy",
    // also needs clsx — should dedupe with card's clsx.
    dependencies: ["clsx"],
    registryDependencies: [],
    files: [
      {
        path: "components/fancy/lib/cn.ts",
        target: "components/fancy/lib/cn.ts",
        type: "registry:lib",
        content: "export function cn() {}\n",
      },
    ],
  },
  accordion: {
    name: "accordion",
    type: "registry:ui",
    title: "Accordion",
    description: "Stateful disclosure surface.",
    package: "react-fancy",
    dependencies: ["lucide-react"],
    registryDependencies: [],
    files: [
      {
        path: "components/fancy/accordion/Accordion.tsx",
        target: "components/fancy/accordion/Accordion.tsx",
        type: "registry:ui",
        content: "export const Accordion = () => null;\n",
      },
    ],
  },
};

/** Install a mocked global fetch that serves the fixtures above. */
export function mockFetch(): void {
  globalThis.fetch = (async (input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (body: unknown, status = 200): Response =>
      ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        json: async () => body,
      }) as Response;

    if (url.endsWith("/r/index.json")) {
      return json(index);
    }
    const m = url.match(/\/r\/([^/]+)\.json$/);
    if (m) {
      const name = decodeURIComponent(m[1]!);
      const item = items[name];
      if (item) return json(item);
      return json({ error: `registry item '${name}' not found` }, 200);
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
}

export { REGISTRY };
