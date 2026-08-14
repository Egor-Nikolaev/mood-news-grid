import "./globals.css";
import { Inter, Lora } from "next/font/google";

// Inter — интерфейс/текст, Lora — серифные заголовки (editorial-подача).
// Оба шрифта поддерживают кириллицу.
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
const lora = Lora({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata = {
  title: "Настроение новостей",
  description:
    "Реальные новости в пяти эмоциональных режимах. Факты остаются неизменными и проверяются кодом.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru" className={`${inter.variable} ${lora.variable}`}>
      <body>{children}</body>
    </html>
  );
}
