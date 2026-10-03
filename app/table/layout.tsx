import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spades at the Table",
  description:
    "Pass-and-play spades for one phone. Each player unlocks their own hand with a secret key.",
};

export default function TableLayout({ children }: LayoutProps<"/table">) {
  return children;
}
