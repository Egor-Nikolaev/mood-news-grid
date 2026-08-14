import "./globals.css";

export const metadata = {
  title: "Mood News Grid",
  description: "Реальные новости в разных эмоциональных режимах. Факты неизменны.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
