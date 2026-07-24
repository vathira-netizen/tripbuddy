import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="text-2xl font-bold text-indigo-600">
            TripBuddy
          </Link>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Budget-first travel planning
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
