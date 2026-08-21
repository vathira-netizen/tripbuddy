import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-4 py-12">
      <div className="grid w-full max-w-3xl overflow-hidden rounded-[28px] border border-line shadow-sm md:grid-cols-2">
        {/* Left panel — hidden on narrow screens; the form alone still works there. */}
        <div className="relative hidden overflow-hidden bg-brand-teal p-10 text-background md:block">
          <Link href="/" className="inline-block">
            <Image
              src="/brand/logo-horizontal-reversed.svg"
              alt="TripBuddy"
              width={170}
              height={27}
              className="h-7 w-auto"
            />
          </Link>
          {/* Decorative marketing copy, not the page heading — each page's own
              <h1> (e.g. "Welcome back") is the real title. */}
          <p className="mt-10 font-serif text-4xl leading-[1.05]">
            Travel is better with the right company.
          </p>
          <p className="mt-4 max-w-[280px] text-sm text-[#b9cac8]">
            Match with travellers who share your route, budget and pace.
          </p>
          <span
            aria-hidden
            className="absolute -bottom-8 -right-8 h-40 w-40 rounded-full border-2 border-brand-coral/50"
          />
        </div>

        <div className="bg-surface p-9 sm:p-11">{children}</div>
      </div>
    </main>
  );
}
