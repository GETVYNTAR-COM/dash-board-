'use client';

import { useState } from 'react';
import Link from 'next/link';

const features = [
  {
    title: 'AI Citation Optimizer',
    description: 'Our AI analyzes your business category, location, and competitors to recommend the highest-impact directories for maximum local visibility.',
    icon: '🎯',
  },
  {
    title: 'AI Report Generator',
    description: 'Generate white-label citation audit reports, competitor analyses, and monthly performance reports in seconds with Claude AI.',
    icon: '📊',
  },
  {
    title: 'AI NAP Checker',
    description: 'Automatically detect Name, Address, Phone inconsistencies across all directories and get AI-powered correction recommendations.',
    icon: '✅',
  },
  {
    title: '60+ UK Directories',
    description: 'Submit to Google Business, Yell, Thomson Local, Checkatrade, Trustpilot, and 60+ more UK-specific directories from one dashboard.',
    icon: '🇬🇧',
  },
  {
    title: 'Automated Submissions',
    description: 'Set it and forget it. Our system handles directory submissions, monitors listing status, and alerts you to any issues.',
    icon: '⚡',
  },
  {
    title: 'White-Label Dashboard',
    description: 'Give your clients their own branded portal to track citation progress, view reports, and see their local SEO improvements.',
    icon: '🏷️',
  },
];

const pricingTiers = [
  {
    name: 'Starter',
    price: '297',
    description: 'Perfect for freelancers managing a handful of local clients.',
    features: [
      'Up to 10 clients',
      '30 directories per client',
      'AI Citation Optimizer',
      'Monthly AI reports',
      'NAP consistency checker',
      'Email support',
    ],
    cta: 'Start Free Trial',
    popular: false,
  },
  {
    name: 'Growth',
    price: '497',
    description: 'For growing agencies scaling their local SEO services.',
    features: [
      'Up to 50 clients',
      '50 directories per client',
      'AI Citation Optimizer',
      'Weekly AI reports',
      'NAP consistency checker',
      'Competitor tracking',
      'White-label dashboard',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    popular: true,
  },
  {
    name: 'Agency',
    price: '997',
    description: 'For established agencies with high-volume citation needs.',
    features: [
      'Unlimited clients',
      '65+ directories per client',
      'AI Citation Optimizer',
      'On-demand AI reports',
      'NAP consistency checker',
      'Competitor tracking',
      'White-label everything',
      'API access',
      'Dedicated account manager',
    ],
    cta: 'Start Free Trial',
    popular: false,
  },
];

const faqs = [
  {
    question: 'What is citation building and why does it matter?',
    answer: 'Citation building is the process of listing your business on online directories (like Yell, Google Business, Trustpilot, etc.). Consistent citations across authoritative directories are a major ranking factor for local search results. Businesses with more accurate citations rank higher in Google Maps and local pack results.',
  },
  {
    question: 'How does the AI Citation Optimizer work?',
    answer: 'Our AI analyzes your client\'s business category, location, existing citations, and competitor profiles. It then recommends the highest-impact directories to target first, prioritizing by domain authority, category relevance, and your specific market. This means better results, faster.',
  },
  {
    question: 'Do you support UK-specific directories?',
    answer: 'Absolutely. We\'ve built this specifically for the UK market. Our database includes 65+ UK directories including Yell, Thomson Local, 192.com, Scoot, Checkatrade, MyBuilder, FreeIndex, and many more trade-specific directories.',
  },
  {
    question: 'What is NAP consistency and why does it matter?',
    answer: 'NAP stands for Name, Address, Phone number. Google uses NAP data across directories to verify a business\'s legitimacy. If your NAP data is inconsistent (different phone numbers, old addresses, misspelled names), it confuses search engines and can tank your local rankings.',
  },
  {
    question: 'Can I white-label reports for my clients?',
    answer: 'Yes! Growth and Agency plans include full white-label capabilities. Generate branded PDF reports, give clients access to their own dashboard, and remove all VYNTAR branding. Your clients will think you built it yourself.',
  },
  {
    question: 'Is there a free trial?',
    answer: 'Yes, every plan comes with a 14-day free trial. No credit card required. You\'ll get full access to all features in your chosen plan so you can test everything before committing.',
  },
  {
    question: 'How long does it take to see results?',
    answer: 'Most directories go live within 1-4 weeks depending on their review process. You\'ll typically see improvements in local rankings within 4-8 weeks of building a consistent citation profile across authoritative directories.',
  },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Navigation */}
      <nav className="fixed top-0 z-50 w-full border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 font-bold text-white text-sm">V</div>
            <span className="text-xl font-bold text-white">VYNTAR</span>
            <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-400">Local SEO</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-gray-400 transition-colors hover:text-white">Features</a>
            <a href="#pricing" className="text-sm text-gray-400 transition-colors hover:text-white">Pricing</a>
            <a href="#faq" className="text-sm text-gray-400 transition-colors hover:text-white">FAQ</a>
            <Link href="/auth/login" className="text-sm text-gray-400 transition-colors hover:text-white">Log in</Link>
            <Link href="/auth/signup" className="btn-primary text-sm">Start Free Trial</Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-32 pb-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-500/20 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-7xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/20 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400 mb-8">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" />
            Built for UK agencies
          </div>
          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight text-white sm:text-7xl">
            Local SEO on{' '}
            <span className="bg-gradient-to-r from-brand-400 to-emerald-300 bg-clip-text text-transparent">
              Autopilot
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400 leading-relaxed">
            AI-powered citation building across 60+ UK directories. Automate submissions,
            monitor NAP consistency, and generate white-label reports — all from one dashboard.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/auth/signup" className="btn-primary px-8 py-4 text-base">
              Start 14-Day Free Trial
            </Link>
            <a href="#features" className="btn-secondary px-8 py-4 text-base">
              See Features
            </a>
          </div>
          <p className="mt-4 text-sm text-gray-500">No credit card required. Cancel anytime.</p>

          {/* Stats bar */}
          <div className="mx-auto mt-16 grid max-w-3xl grid-cols-3 gap-8 rounded-2xl border border-gray-800 bg-gray-900/50 p-8 backdrop-blur-sm">
            <div>
              <div className="text-3xl font-bold text-brand-400">65+</div>
              <div className="mt-1 text-sm text-gray-400">UK Directories</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-brand-400">98%</div>
              <div className="mt-1 text-sm text-gray-400">NAP Accuracy</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-brand-400">3x</div>
              <div className="mt-1 text-sm text-gray-400">Faster Results</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              Everything you need for{' '}
              <span className="text-brand-400">local SEO dominance</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-gray-400">
              Stop manually submitting to directories. Let AI handle the strategy while automation handles the execution.
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="card group transition-all hover:border-brand-500/30">
                <div className="mb-4 text-3xl">{feature.icon}</div>
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-sm text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-y border-gray-800 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
            Three steps to <span className="text-brand-400">local SEO success</span>
          </h2>
          <div className="mt-16 grid gap-12 md:grid-cols-3">
            {[
              { step: '01', title: 'Add Your Clients', desc: 'Enter business details — name, address, phone, category, postcode. Our AI immediately audits their existing citation profile.' },
              { step: '02', title: 'AI Optimizes Strategy', desc: 'Claude AI analyzes competitors, identifies gaps, and recommends the highest-impact directories to target first.' },
              { step: '03', title: 'Automate & Report', desc: 'We handle submissions to 65+ directories. Track progress in real-time and generate white-label reports for your clients.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-2xl font-bold text-brand-400">
                  {item.step}
                </div>
                <h3 className="mt-6 text-xl font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              Simple, transparent <span className="text-brand-400">pricing</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-gray-400">
              All plans include a 14-day free trial. No credit card required.
            </p>
          </div>
          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl border p-8 ${
                  tier.popular
                    ? 'border-brand-500 bg-gray-900/80 shadow-lg shadow-brand-500/10'
                    : 'border-gray-800 bg-gray-900/50'
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white">
                    Most Popular
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white">{tier.name}</h3>
                <p className="mt-2 text-sm text-gray-400">{tier.description}</p>
                <div className="mt-6">
                  <span className="text-4xl font-bold text-white">£{tier.price}</span>
                  <span className="text-gray-400">/mo</span>
                </div>
                <Link
                  href="/auth/signup"
                  className={`mt-8 block w-full rounded-lg py-3 text-center text-sm font-semibold transition-all ${
                    tier.popular
                      ? 'bg-brand-500 text-white hover:bg-brand-600'
                      : 'border border-gray-700 bg-gray-800 text-white hover:bg-gray-700'
                  }`}
                >
                  {tier.cta}
                </Link>
                <ul className="mt-8 space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-gray-300">
                      <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="border-t border-gray-800 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
            Frequently asked <span className="text-brand-400">questions</span>
          </h2>
          <div className="mt-12 space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/50">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left"
                >
                  <span className="font-medium text-white">{faq.question}</span>
                  <svg
                    className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="border-t border-gray-800 px-6 py-4">
                    <p className="text-sm text-gray-400 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-gray-800 py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to automate your{' '}
            <span className="text-brand-400">local SEO?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-gray-400">
            Join UK agencies already using VYNTAR to manage citations, track NAP consistency, and generate AI-powered reports.
          </p>
          <div className="mt-8">
            <Link href="/auth/signup" className="btn-primary px-8 py-4 text-base">
              Start Your 14-Day Free Trial
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-brand-500 text-xs font-bold text-white">V</div>
              <span className="font-semibold text-white">VYNTAR Local SEO</span>
            </div>
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} VYNTAR. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
