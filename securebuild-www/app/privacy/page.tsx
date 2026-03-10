import Link from "next/link"
import Image from "next/image"
import { Badge } from "@/components/ui/badge"
import Navbar from "@/components/navbar"

export const metadata = {
  title: "Privacy Policy - SecureBuild",
  description: "SecureBuild Privacy Policy",
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto max-w-4xl px-4 md:px-8 lg:px-12 py-12">
          {/* Header Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 mb-8">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                SecureBuild Privacy Policy
              </h1>
              <Badge variant="outline" className="text-sm">
                Effective Date: June 19, 2025
              </Badge>
            </div>
            
            <div className="prose prose-gray dark:prose-invert max-w-none">
              <p className="text-base leading-relaxed mb-4">
                This Privacy Policy explains how <strong>Replicated, Inc.</strong> ("Replicated," "we," "our," or "us") collects, uses, and shares Personal Data through the SecureBuild platform at{" "}
                <Link href="https://securebuild.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                  securebuild.com
                </Link>
                , including for users who register for free accounts and those who purchase SecureBuild Images or services.
              </p>
              <p className="text-base leading-relaxed">
                We are committed to protecting your privacy and complying with all applicable data protection laws, including:
              </p>
              <ul className="space-y-2 ml-4 mt-4">
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2 mt-1">•</span>
                  General Data Protection Regulation (EU & UK GDPR)
                </li>
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2 mt-1">•</span>
                  California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA)
                </li>
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2 mt-1">•</span>
                  Other relevant U.S. and international privacy laws
                </li>
              </ul>
            </div>
          </div>

          {/* Privacy Sections */}
          <div className="space-y-6">
            {/* Section 1 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">1</span>
                Who Controls Your Data
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                Replicated acts as a <strong>data controller</strong> for Personal Data collected through SecureBuild. If your organization enters into a purchase agreement for SecureBuild Images, we may also act as a <strong>data processor</strong>, governed by that agreement and any applicable Data Processing Addendum (DPA).
              </p>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed mt-4">
                If anyone on your team completes a purchase, the terms of that agreement may govern how we process data for all associated users.
              </p>
            </div>

            {/* Section 2 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">2</span>
                What Personal Data We Collect
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>When you create or use a SecureBuild account, we may collect:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-green-500 mr-2 mt-1">•</span>
                    <strong>Identifiers</strong>: Name, email, company, username, password
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-500 mr-2 mt-1">•</span>
                    <strong>Usage data</strong>: IP address, device/browser info, site activity, login logs
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-500 mr-2 mt-1">•</span>
                    <strong>Support data</strong>: Messages, technical issue reports, feature requests
                  </li>
                  <li className="flex items-start">
                    <span className="text-green-500 mr-2 mt-1">•</span>
                    <strong>Cookie and analytics data</strong>
                  </li>
                </ul>
              </div>
            </div>

            {/* Section 3 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">3</span>
                Additional Personal Data for Paid Services
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>If you purchase SecureBuild Images or services, we may also collect:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-purple-500 mr-2 mt-1">•</span>
                    Company name
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-500 mr-2 mt-1">•</span>
                    Contact details for technical, support, and billing personnel
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-500 mr-2 mt-1">•</span>
                    Company address
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-500 mr-2 mt-1">•</span>
                    Billing data via third-party payment processors
                  </li>
                  <li className="flex items-start">
                    <span className="text-purple-500 mr-2 mt-1">•</span>
                    Deployment metadata related to your use of SecureBuild
                  </li>
                </ul>
                <p>
                  Payment data is handled through PCI/DSS-compliant providers. Replicated does not store full payment card details.
                </p>
              </div>
            </div>

            {/* Section 4 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">4</span>
                How We Use Personal Data
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>We use Personal Data to:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Create and manage user accounts
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Authenticate users and secure access
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Provide support and respond to inquiries
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Improve SecureBuild and understand usage
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Deliver purchased services and features
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Comply with legal obligations and enforce our rights
                  </li>
                  <li className="flex items-start">
                    <span className="text-orange-500 mr-2 mt-1">•</span>
                    Send service-related notices and occasional marketing communications
                  </li>
                </ul>
                <p>
                  We may also generate aggregated or anonymized data for internal analytics or reports. This data does not identify individuals and may be shared freely.
                </p>
              </div>
            </div>

            {/* Section 5 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">5</span>
                Cookies and Analytics
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>We use cookies and similar technologies to:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-teal-500 mr-2 mt-1">•</span>
                    Manage sessions and logins
                  </li>
                  <li className="flex items-start">
                    <span className="text-teal-500 mr-2 mt-1">•</span>
                    Monitor site usage and performance
                  </li>
                  <li className="flex items-start">
                    <span className="text-teal-500 mr-2 mt-1">•</span>
                    Improve marketing effectiveness
                  </li>
                  <li className="flex items-start">
                    <span className="text-teal-500 mr-2 mt-1">•</span>
                    Deliver ads on platforms like Twitter or LinkedIn
                  </li>
                </ul>
                <p>
                  You can manage cookie settings in your browser. See our{" "}
                  <Link href="https://replicated.com/cookie-policy" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    Cookie Policy
                  </Link>{" "}
                  for details.
                </p>
              </div>
            </div>

            {/* Section 6 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">6</span>
                Subprocessors
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                Replicated may engage subprocessors to operate SecureBuild. These vendors are contractually bound to protect Personal Data. A current list is available at:{" "}
                <Link href="https://docs.replicated.com/vendor/policies-infrastructure-and-subprocessors" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium break-all">
                  docs.replicated.com/vendor/policies-infrastructure-and-subprocessors
                </Link>
              </p>
            </div>

            {/* Section 7 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">7</span>
                Security Measures
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>
                  We implement technical, organizational, and physical safeguards to protect Personal Data. This includes access controls, encryption, secure hosting, and employee security training.
                </p>
                <p>
                  Replicated has completed a SOC 2 Type II audit. Reports are available to current customers under NDA.
                </p>
                <p>
                  No internet-based service is completely secure. If you believe your account has been compromised, contact{" "}
                  <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    privacy@replicated.com
                  </Link>{" "}
                  immediately.
                </p>
              </div>
            </div>

            {/* Section 8 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">8</span>
                Legal Bases for Processing
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>Replicated processes Personal Data under the following lawful bases:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-indigo-500 mr-2 mt-1">•</span>
                    <strong>Consent</strong> (e.g., newsletter signups)
                  </li>
                  <li className="flex items-start">
                    <span className="text-indigo-500 mr-2 mt-1">•</span>
                    <strong>Contractual necessity</strong> (e.g., account management, paid services)
                  </li>
                  <li className="flex items-start">
                    <span className="text-indigo-500 mr-2 mt-1">•</span>
                    <strong>Legal obligation</strong> (e.g., export compliance, tax)
                  </li>
                  <li className="flex items-start">
                    <span className="text-indigo-500 mr-2 mt-1">•</span>
                    <strong>Legitimate interests</strong> (e.g., fraud prevention, service improvement)
                  </li>
                </ul>
                <p>
                  We perform balancing tests where required to ensure our interests do not override your rights.
                </p>
              </div>
            </div>

            {/* Section 9 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">9</span>
                International Transfers
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>Your data may be processed in the United States and other countries. When transferring Personal Data internationally, we use appropriate safeguards including:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-pink-500 mr-2 mt-1">•</span>
                    Standard Contractual Clauses (SCCs)
                  </li>
                  <li className="flex items-start">
                    <span className="text-pink-500 mr-2 mt-1">•</span>
                    Transfer Impact Assessments (TIAs)
                  </li>
                  <li className="flex items-start">
                    <span className="text-pink-500 mr-2 mt-1">•</span>
                    Data Processing Agreements (DPAs)
                  </li>
                </ul>
                <p>
                  SecureBuild infrastructure is hosted on Amazon Web Services (U.S.).
                </p>
              </div>
            </div>

            {/* Section 10 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">10</span>
                Retention Periods
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>We retain Personal Data only as long as needed:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-red-500 mr-2 mt-1">•</span>
                    <strong>Account data</strong>: while your account is active or until deleted
                  </li>
                  <li className="flex items-start">
                    <span className="text-red-500 mr-2 mt-1">•</span>
                    <strong>Billing and audit logs</strong>: up to 7 years (as required by law)
                  </li>
                  <li className="flex items-start">
                    <span className="text-red-500 mr-2 mt-1">•</span>
                    <strong>Support tickets and technical logs</strong>: typically 12–24 months
                  </li>
                  <li className="flex items-start">
                    <span className="text-red-500 mr-2 mt-1">•</span>
                    <strong>Anonymized data</strong> may be retained indefinitely
                  </li>
                </ul>
                <p>
                  After retention periods, we delete or anonymize your data securely.
                </p>
              </div>
            </div>

            {/* Section 11 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">11</span>
                Marketing and Communication Preferences
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>We may contact you with relevant announcements or marketing if:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-cyan-500 mr-2 mt-1">•</span>
                    You signed up and have not opted out
                  </li>
                  <li className="flex items-start">
                    <span className="text-cyan-500 mr-2 mt-1">•</span>
                    It relates to products or services you use
                  </li>
                  <li className="flex items-start">
                    <span className="text-cyan-500 mr-2 mt-1">•</span>
                    You've given explicit consent
                  </li>
                </ul>
                <p>
                  You can unsubscribe using the link in any message or email us at{" "}
                  <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    privacy@replicated.com
                  </Link>.
                </p>
                <p>
                  We honor Global Privacy Control (GPC) signals as valid opt-out requests where legally required.
                </p>
              </div>
            </div>

            {/* Section 12 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">12</span>
                Automated Processing and Profiling
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>
                  We may use limited automated decision-making to optimize ad targeting or detect abuse. These processes do not produce legal or similarly significant effects on users.
                </p>
                <p>
                  If you are in the EEA or UK, you may object to profiling or automated decisions by contacting{" "}
                  <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    privacy@replicated.com
                  </Link>.
                </p>
              </div>
            </div>

            {/* Section 13 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">13</span>
                Your Rights
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>Depending on your location, you may have the right to:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-emerald-500 mr-2 mt-1">•</span>
                    Access, correct, or delete your Personal Data
                  </li>
                  <li className="flex items-start">
                    <span className="text-emerald-500 mr-2 mt-1">•</span>
                    Object to or restrict certain processing
                  </li>
                  <li className="flex items-start">
                    <span className="text-emerald-500 mr-2 mt-1">•</span>
                    Withdraw consent
                  </li>
                  <li className="flex items-start">
                    <span className="text-emerald-500 mr-2 mt-1">•</span>
                    Lodge a complaint with a supervisory authority
                  </li>
                </ul>
                <p>
                  To exercise these rights, email us at{" "}
                  <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    privacy@replicated.com
                  </Link>. We may require identity verification.
                </p>
              </div>
            </div>

            {/* Section 14 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">14</span>
                California Privacy Rights
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>California residents have additional rights under the CCPA/CPRA, including:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-amber-500 mr-2 mt-1">•</span>
                    Right to know what data we collect and share
                  </li>
                  <li className="flex items-start">
                    <span className="text-amber-500 mr-2 mt-1">•</span>
                    Right to request correction or deletion
                  </li>
                  <li className="flex items-start">
                    <span className="text-amber-500 mr-2 mt-1">•</span>
                    Right to opt out of Personal Data sharing
                  </li>
                  <li className="flex items-start">
                    <span className="text-amber-500 mr-2 mt-1">•</span>
                    Right to non-discrimination
                  </li>
                </ul>
                <p>
                  We do not sell Personal Data for monetary value. We respond to verifiable consumer requests within 45 days (or up to 90 days with notice).
                </p>
                <p>
                  To make a request, email{" "}
                  <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    privacy@replicated.com
                  </Link>.
                </p>
              </div>
            </div>

            {/* Section 15 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">15</span>
                Other U.S. State Privacy Rights
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>Residents of Colorado, Connecticut, Utah, Virginia, and Nevada may have additional rights to:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start">
                    <span className="text-lime-500 mr-2 mt-1">•</span>
                    Opt out of targeted advertising or profiling
                  </li>
                  <li className="flex items-start">
                    <span className="text-lime-500 mr-2 mt-1">•</span>
                    Request corrections or deletions
                  </li>
                  <li className="flex items-start">
                    <span className="text-lime-500 mr-2 mt-1">•</span>
                    Appeal a denied privacy request
                  </li>
                </ul>
                <p>
                  Email{" "}
                  <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                    privacy@replicated.com
                  </Link>{" "}
                  to exercise these rights.
                </p>
              </div>
            </div>

            {/* Section 16 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">16</span>
                Changes to This Policy
              </h2>
              <div className="text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
                <p>
                  We may update this Privacy Policy from time to time. If material changes are made, we will provide advance notice via email or site notification at least 14 days before the new terms take effect.
                </p>
                <p className="text-sm italic">
                  <em>Last updated: June 19, 2025</em>
                </p>
              </div>
            </div>

            {/* Section 17 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">17</span>
                Contact Us
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                Questions or privacy-related concerns?<br />
                Email the Privacy Office:{" "}
                <Link href="mailto:privacy@replicated.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                  privacy@replicated.com
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
      
      <footer className="w-full py-6 md:py-12 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <div className="flex flex-col items-center justify-center space-y-4 text-center">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
              <span className="text-xl font-bold">SecureBuild</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
} 