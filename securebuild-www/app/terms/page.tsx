import Link from "next/link"
import Image from "next/image"
import { Badge } from "@/components/ui/badge"
import Navbar from "@/components/navbar"

export const metadata = {
  title: "Terms of Use - SecureBuild",
  description: "SecureBuild Terms of Use for Registered Accounts",
}

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto max-w-4xl px-4 md:px-8 lg:px-12 py-12">
          {/* Header Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 mb-8">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                SecureBuild Terms of Use
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-300 mb-4">
                For Registered Accounts (No Purchase)
              </p>
              <Badge variant="outline" className="text-sm">
                Effective Date: June 19, 2025
              </Badge>
            </div>
            
            <div className="prose prose-gray dark:prose-invert max-w-none">
              <p className="text-base leading-relaxed">
                SecureBuild is a service operated by <strong>Replicated, Inc.</strong> These Terms apply to individuals or entities ("Users") who create an account on{" "}
                <Link href="https://securebuild.com" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium">
                  securebuild.com
                </Link>
                {" "}but do not purchase or subscribe to paid services.
              </p>
            </div>
          </div>

          {/* Terms Sections */}
          <div className="space-y-6">
            {/* Section 1 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">1</span>
                Scope
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                These Terms govern your use of the SecureBuild website and any free services or features accessible with a registered account. If you or anyone from your organization later enters into a purchase agreement with Replicated (including purchasing SecureBuild Images), that agreement will supersede these Terms and will govern all use by your team and organization.
              </p>
            </div>

            {/* Section 2 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">2</span>
                Account Registration
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                You must provide accurate information when creating your account. Replicated may refuse or revoke access if your chosen username or account activity is deemed inappropriate or violates these Terms.
              </p>
            </div>

            {/* Section 3 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">3</span>
                Acceptable Use and Restrictions
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-4">You agree not to:</p>
              <ul className="space-y-2 text-gray-700 dark:text-gray-300">
                <li className="flex items-start">
                  <span className="text-red-500 mr-2 mt-1">•</span>
                  Reverse engineer, disassemble, or attempt to access the source code of SecureBuild software or services.
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 mr-2 mt-1">•</span>
                  Use the services to host or deliver applications or content not permitted by Replicated.
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 mr-2 mt-1">•</span>
                  Use your account to violate any applicable law, regulation, or third-party rights.
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 mr-2 mt-1">•</span>
                  Interfere with or disrupt the service, servers, or networks.
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 mr-2 mt-1">•</span>
                  Use the site for any commercial purpose without a purchase agreement.
                </li>
              </ul>
            </div>

            {/* Section 4 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">4</span>
                Intellectual Property and Confidentiality
              </h2>
              <div className="space-y-4 text-gray-700 dark:text-gray-300 leading-relaxed">
                <p>
                  All content, software, and intellectual property related to SecureBuild is owned by Replicated. You may not copy, modify, or distribute any part of the service without permission.
                </p>
                <p>
                  If you provide feedback or data to Replicated, Replicated may use it to improve the service, provided no personal data is disclosed in a way that can identify you.
                </p>
              </div>
            </div>

            {/* Section 5 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">5</span>
                Termination
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                Replicated may suspend or terminate your account at any time, for any reason, including misuse or inactivity.
              </p>
            </div>

            {/* Section 6 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">6</span>
                Disclaimers
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                The SecureBuild service is provided "as is" without warranties of any kind. Replicated makes no guarantees about the accuracy, availability, or security of the service.
              </p>
            </div>

            {/* Section 7 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">7</span>
                Limitation of Liability
              </h2>
              <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                To the fullest extent permitted by law, Replicated is not liable for any indirect, incidental, or consequential damages, or for any loss of data, business, or profits. Total liability is limited to{" "}
                <span className="font-bold text-green-600 dark:text-green-400">$100</span>.
              </p>
            </div>

            {/* Section 8 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold mr-3">8</span>
                Miscellaneous
              </h2>
              <div className="space-y-4 text-gray-700 dark:text-gray-300 leading-relaxed">
                <p>
                  These Terms are governed by the laws of the State of California, without regard to its conflict of law provisions.
                </p>
                <p>
                  You may not assign your rights under these Terms without Replicated's prior written consent. If any part of these Terms is found to be invalid or unenforceable, the remaining provisions will continue in full force and effect.
                </p>
              </div>
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