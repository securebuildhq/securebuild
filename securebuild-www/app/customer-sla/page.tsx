import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function CustomerSLAPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b bg-gray-50">
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">SecureBuild Customer Service Level Agreement</h1>
          <p className="text-sm text-gray-600 mt-1">Common Vulnerabilities and Exposures (CVE) Remediation</p>
          <div className="mt-4">
            <Link 
              href="/purchase-terms" 
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              ← Back to Purchase Terms Agreement
            </Link>
          </div>
        </div>
      </div>

      {/* Legal Document Content */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="prose prose-lg max-w-none">
          
          <div className="bg-blue-50 border-l-4 border-blue-400 p-6 mb-8">
            <p className="text-sm font-medium text-blue-800 leading-relaxed">
              This Service Level Agreement is incorporated by reference into the <Link href="/purchase-terms" className="text-blue-600 hover:text-blue-800">SecureBuild Image Customer Subscription Agreement</Link>. 
              The terms defined in the main agreement apply to this SLA.
            </p>
          </div>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-6">Common Vulnerabilities and Exposures (CVEs)</h2>
            
            <div className="bg-gray-50 p-6 rounded-lg mb-6">
              <p className="leading-relaxed">
                Licensor will use commercially reasonable efforts to address CVEs as published pursuant to the CVE Program overseen by the MITRE Corporation (<Link href="https://cve.org" className="text-blue-600 hover:text-blue-800" target="_blank" rel="noopener noreferrer">cve.org</Link>), provided such CVEs meet all of the following requirements (each a <strong>&ldquo;Validated CVE&rdquo;</strong>):
              </p>
            </div>

            <div className="space-y-6">
              <div className="border-l-4 border-gray-300 pl-6">
                <h3 className="font-semibold mb-2">CVE Validation Requirements</h3>
                <ul className="space-y-3 text-gray-700">
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 w-2 h-2 bg-gray-400 rounded-full mt-2"></span>
                    <span>Scanners used by Licensor confirm the CVE affects the SecureBuild Image;</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 w-2 h-2 bg-gray-400 rounded-full mt-2"></span>
                    <span>The CVE is independently fixable of any other bugs;</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 w-2 h-2 bg-gray-400 rounded-full mt-2"></span>
                    <div>
                      <span>The CVE is:</span>
                      <ul className="ml-4 mt-2 space-y-1">
                        <li>(i) acknowledged or documented by the affected upstream maintainer (the <strong>&ldquo;Maintainer&rdquo;</strong>) of the applicable open-source software project;</li>
                        <li>(ii) the Maintainer has made available an upstream release version that is verified (e.g. via release notes or code commit message) to provide a fix for the CVE;</li>
                        <li>(iii) the affected SecureBuild Image can be rebuilt with updated compilers and/or libraries to remediate the CVE; and</li>
                        <li>(iv) the CVE is not caused by or related to any image, operating system, or platform not provided by Licensor or used in combination with the SecureBuild Image.</li>
                      </ul>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 w-2 h-2 bg-gray-400 rounded-full mt-2"></span>
                    <span>The CVE impacts a single codebase.</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-6">Severity and Remediation</h2>
            
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 mb-6">
              <p className="text-sm leading-relaxed text-yellow-800">
                Licensor classifies Validated CVEs according to the severity levels defined by the Common Vulnerability Scoring System (<strong>CVSS</strong>) v3.x ratings (<Link href="https://nvd.nist.gov/vuln-metrics/cvss" className="text-yellow-600 hover:text-yellow-800" target="_blank" rel="noopener noreferrer">https://nvd.nist.gov/vuln-metrics/cvss</Link>), and uses commercially reasonable efforts to address Validated CVEs within the estimated time frames set forth below:
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-6 py-4 text-left font-semibold">Severity Level</th>
                    <th className="border border-gray-300 px-6 py-4 text-left font-semibold">Service Level Agreement</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-red-50">
                    <td className="border border-gray-300 px-6 py-4 font-medium text-red-800">Critical</td>
                    <td className="border border-gray-300 px-6 py-4">
                      <strong>6 days</strong> from the date the Maintainer makes the corresponding fix publicly available
                    </td>
                  </tr>
                  <tr className="bg-orange-50">
                    <td className="border border-gray-300 px-6 py-4 font-medium text-orange-800">High, Medium, Low</td>
                    <td className="border border-gray-300 px-6 py-4">
                      <strong>13 days</strong> from the date the Maintainer makes the corresponding fix publicly available
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-6 bg-green-50 border-l-4 border-green-400 p-6">
              <p className="text-sm leading-relaxed text-green-800">
                <strong>Remediation Complete:</strong> A Validated CVE is considered remediated when a rebuilt version of the SecureBuild Image is published to Licensor&apos;s hosted registry.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-6">Important Notes</h2>
            
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-blue-800 mb-2">📅 Timeline Calculation</h3>
                <p className="text-sm text-blue-700">
                  SLA timelines begin when the upstream maintainer makes the fix publicly available, not when the CVE is first disclosed.
                </p>
              </div>

              <div className="bg-purple-50 p-4 rounded-lg">
                <h3 className="font-semibold text-purple-800 mb-2">🔍 CVE Validation</h3>
                <p className="text-sm text-purple-700">
                  Only CVEs that meet all validation requirements are subject to this SLA. CVEs that don&apos;t meet these criteria are addressed on a best-effort basis.
                </p>
              </div>

              <div className="bg-amber-50 p-4 rounded-lg">
                <h3 className="font-semibold text-amber-800 mb-2">⚡ Business Days</h3>
                <p className="text-sm text-amber-700">
                  Business days exclude weekends and recognized U.S. federal holidays.
                </p>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold text-gray-800 mb-2">🏗️ Commercially Reasonable Efforts</h3>
                <p className="text-sm text-gray-700">
                  This SLA represents Licensor&apos;s commitment to use commercially reasonable efforts. Actual remediation times may vary based on complexity and dependencies.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-6">CVSS Severity Levels Reference</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-4 py-3 text-left font-semibold">CVSS Score</th>
                    <th className="border border-gray-300 px-4 py-3 text-left font-semibold">Severity Level</th>
                    <th className="border border-gray-300 px-4 py-3 text-left font-semibold">SecureBuild SLA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-red-50">
                    <td className="border border-gray-300 px-4 py-3 font-mono">9.0 - 10.0</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium text-red-800">Critical</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium">6 business days</td>
                  </tr>
                  <tr className="bg-orange-50">
                    <td className="border border-gray-300 px-4 py-3 font-mono">7.0 - 8.9</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium text-orange-800">High</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium">13 days</td>
                  </tr>
                  <tr className="bg-yellow-50">
                    <td className="border border-gray-300 px-4 py-3 font-mono">4.0 - 6.9</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium text-yellow-800">Medium</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium">13 days</td>
                  </tr>
                  <tr className="bg-green-50">
                    <td className="border border-gray-300 px-4 py-3 font-mono">0.1 - 3.9</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium text-green-800">Low</td>
                    <td className="border border-gray-300 px-4 py-3 font-medium">13 days</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div className="border-t pt-8 mt-12">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <p>
                This SLA is part of the <Link href="/purchase-terms" className="text-blue-600 hover:text-blue-800">SecureBuild Image Customer Subscription Agreement</Link>
              </p>
              <p>
                Last updated: June 16, 2025
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 