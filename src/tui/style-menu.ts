/**
 * ctrl-k › Style: the style taxonomy as a menu tree (families, then each
 * branch down to its leaves). Every row is a `style` command, so the menu
 * and the prompt share one grammar; typing filters the rows of a level.
 */
import { hasCard, STYLE_TREE } from "../../core/styles/index.ts";
import { STYLE_FAMILIES } from "../../core/styles/taxonomy.ts";
import type { StyleId } from "../../core/styles/schema.ts";
import type { MenuContext, MenuNode } from "./menu.ts";

const BAR_CHOICES = [4, 8, 16, 32] as const;

/** The Style row's detail: the song's style, or a hint. */
export function styleMenuDetail(context: MenuContext): string {
  const style = context.score.style;
  if (!style) return "a whole song from a style";
  const name = style.blend ? `${style.id} + ${style.blend.id}` : style.id;
  return `${name} · seed ${style.seed}`;
}

function styleActions(id: StyleId): MenuNode[] {
  const node = STYLE_TREE.get(id)!;
  return [
    ...BAR_CHOICES.map((bars): MenuNode => ({
      kind: "action",
      label: `make ${bars} bars`,
      command: `/style ${id} ${bars}`,
      help: `replace the song with ${bars} bars of ${node.title} (undo restores it)`,
    })),
    {
      kind: "action",
      label: "about",
      command: `/style info ${id}`,
      help: "meter, tempo, groove, tuning, harmony and roles",
    },
  ];
}

function styleNode(id: StyleId): MenuNode {
  const node = STYLE_TREE.get(id)!;
  const card = hasCard(id) ? "" : " · inherits";
  return {
    kind: "menu",
    id: `style:${id}`,
    label: node.title,
    detail: node.leaf
      ? `${id}${card}`
      : `${node.children.length} styles${card}`,
    help: node.region.length ? `${id} · ${node.region.join(", ")}` : id,
    build: () => [
      ...styleActions(id),
      ...node.children.map((child) => styleNode(child)),
    ],
  };
}

/** Style: again, find, then the families. */
export function styleMenuNodes(context: MenuContext): MenuNode[] {
  const current = context.score.style;
  return [
    ...(current
      ? [
          {
            kind: "action",
            label: "again",
            command: "/style again",
            help: `${current.id} with the next seed`,
          } satisfies MenuNode,
        ]
      : []),
    {
      kind: "entry",
      label: "find",
      value: "",
      placeholder: "style name, alias or region",
      command: (text) =>
        text.trim() ? `/style search ${text.trim()}` : undefined,
      example: "/style search samba",
      help: "search every style by name, alias or region",
    },
    {
      kind: "entry",
      label: "blend",
      value: "",
      placeholder: "a b [weight]",
      command: (text) => {
        const words = text.trim().split(/\s+/).filter(Boolean);
        return words.length >= 2 && words.length <= 3
          ? `/style blend ${words.join(" ")}`
          : undefined;
      },
      example: "/style blend bebop bossa-nova 0.3",
      help: "mix two styles; weight 0 is the first, 1 the second",
    },
    ...STYLE_FAMILIES.map((family): MenuNode => ({
      kind: "menu",
      id: `family:${family.key}`,
      label: family.title,
      detail: family.roots.join(" · "),
      help: `${family.key} family`,
      build: () => family.roots.map((root) => styleNode(root)),
    })),
  ];
}
