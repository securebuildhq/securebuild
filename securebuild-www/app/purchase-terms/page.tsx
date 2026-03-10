import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function PurchaseTermsPage() {
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
          <h1 className="text-2xl font-bold text-gray-900">SecureBuild Image Customer Subscription Agreement</h1>
          <p className="text-sm text-gray-600 mt-1">Effective Date: June 16, 2025</p>
        </div>
      </div>

      {/* Legal Document Content */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="prose prose-lg max-w-none">
          
          <div className="bg-gray-50 p-6 rounded-lg mb-8">
            <p className="text-sm leading-relaxed">
              This SecureBuild Image Customer Subscription Agreement, including the Order Form which by this reference is incorporated herein (this <strong>"Agreement"</strong>), is a binding agreement between <strong>Replicated, Inc.</strong> (<strong>"Licensor"</strong>) and the person or entity identified on the Order Form as the licensee of the SecureBuild Image (<strong>"Licensee"</strong>).
            </p>
          </div>

          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 mb-8">
            <p className="text-sm font-medium text-yellow-800 leading-relaxed">
              LICENSOR PROVIDES THE SOFTWARE SOLELY ON THE TERMS AND CONDITIONS SET FORTH IN THIS AGREEMENT AND ON THE CONDITION THAT LICENSEE ACCEPTS AND COMPLIES WITH THEM. BY CHECKING THE "ACCEPT" BOX, SUBMITTING AN ORDER ON THE SECUREBUILD SITE AND ACCESSING AND USING THE SECUREBUILD IMAGE, LICENSEE (A) ACCEPTS THIS AGREEMENT AND AGREES THAT LICENSEE IS LEGALLY BOUND BY ITS TERMS; AND (B) REPRESENTS AND WARRANTS THAT: (I) THE INDIVIDUAL ACCEPTING THIS AGREEMENT ON BEHALF OF LICENSEE HAS THE RIGHT, POWER, AND AUTHORITY TO ENTER INTO THIS AGREEMENT ON LICENSEE'S BEHALF AND TO BIND LICENSEE TO ITS TERMS. IF LICENSEE DOES NOT AGREE TO THE TERMS OF THIS AGREEMENT, LICENSOR WILL NOT AND DOES NOT LICENSE THE SECUREBUILD IMAGE TO LICENSEE AND LICENSEE MUST NOT ACCESS, DOWNLOAD, INSTALL OR USE THE SECUREBUILD IMAGE OR ITS DOCUMENTATION.
            </p>
          </div>

          <div className="bg-red-50 border-l-4 border-red-400 p-6 mb-8">
            <p className="text-sm font-medium text-red-800 leading-relaxed">
              NOTWITHSTANDING ANYTHING TO THE CONTRARY IN THIS AGREEMENT OR LICENSEE'S ACCEPTANCE OF THE TERMS AND CONDITIONS OF THIS AGREEMENT, NO LICENSE IS GRANTED (WHETHER EXPRESSLY, BY IMPLICATION, OR OTHERWISE) UNDER THIS AGREEMENT, AND THIS AGREEMENT EXPRESSLY EXCLUDES ANY RIGHT, CONCERNING ANY SECUREBUILD IMAGE THAT LICENSEE DID NOT ACQUIRE LAWFULLY OR THAT IS NOT A LEGITIMATE, AUTHORIZED COPY OF THE SECUREBUILD IMAGE.
            </p>
          </div>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">1. Definitions</h2>
            <p className="mb-4">For purposes of this Agreement, the following terms have the following meanings:</p>
            
            <div className="space-y-4 ml-4">
              <div>
                <p><strong>"Distribution Solution"</strong> means Licensor's hosted platform that is licensed on a software-as-a-service basis and includes software distribution and management tools and capabilities that enable Licensee to distribute its software application(s) to its customers. The Distribution Solution is licensed under a separate agreement.</p>
              </div>
              
              <div>
                <p><strong>"Documentation"</strong> means the official SecureBuild Image documentation made generally available to licensees of the SecureBuild Image through the SecureBuild Site.</p>
              </div>
              
              <div>
                <p><strong>"Fees"</strong> means the fees paid or required to be paid by Licensee for the subscription license to the SecureBuild Image granted under this Agreement.</p>
              </div>
              
              <div>
                <p><strong>"Intellectual Property Rights"</strong> means any and all registered and unregistered rights granted, applied for, or otherwise now or hereafter in existence under or related to any patent, copyright, trademark, trade secret, database protection, or other intellectual property rights laws, and all similar or equivalent rights or forms of protection, in any part of the world.</p>
              </div>
              
              <div>
                <p><strong>"Licensee Application"</strong> means Licensee's proprietary software application that Licensee distributes to its customers utilizing the Distribution Solution.</p>
              </div>
              
              <div>
                <p><strong>"Order Form"</strong> means the on-line order form filled out and submitted by or on behalf of Licensee, and accepted by Licensor, for Licensee's purchase of the subscription license to the SecureBuild Image granted under this Agreement. Order Forms are accessed and submitted via the SecureBuild Site.</p>
              </div>
              
              <div>
                <p><strong>"Person"</strong> means an individual, corporation, partnership, joint venture, limited liability company, governmental authority, unincorporated organization, trust, association, or other entity.</p>
              </div>
              
              <div>
                <p><strong>"Representatives"</strong> means, as to any Person, such Person's affiliates and its or their directors, officers, employees, agents, consultants, contractors, and advisors (including, without limitation, financial advisors, counsel and accountants).</p>
              </div>
              
              <div>
                <p><strong>"SecureBuild Image"</strong> means a customized, secure image version of an open-source software image as identified on the Order Form that is hosted and distributed on a subscription basis through the SecureBuild Site.</p>
              </div>
              
              <div>
                <p><strong>"SecureBuild Site"</strong> is the website owned, operated and managed by Licensor which hosts the SecureBuild Image for subscribers pursuant to the terms of a customer subscription agreement.</p>
              </div>
              
              <div>
                <p><strong>"Subscription Term"</strong> is the term of the subscription license granted with respect to the SecureBuild Image as identified in the Order Form. The Subscription Term commences on the Effective Date.</p>
              </div>
              
              <div>
                <p><strong>"Third Party"</strong> means any Person other than Licensee or Licensor.</p>
              </div>
              
              <div>
                <p><strong>"Updates"</strong> means new versions of the SecureBuild Image made generally available to subscribers to the SecureBuild Image pursuant to the terms of their subscription agreements. Updates typically address newly identified CVEs.</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">2. License Grant and Scope</h2>
            <p className="mb-4">Subject to and conditioned upon Licensee's payment of the Fees and Licensee's compliance with all terms and conditions set forth in this Agreement, Licensor hereby grants Licensee a non-exclusive, non-sublicensable (except to Licensee's customers as expressly provided herein), non-transferable (except in compliance with Section 15(e)), license, during the Term to:</p>
            
            <div className="space-y-4 ml-4">
              <div>
                <h3 className="font-semibold mb-2">a) Installation and Property Rights</h3>
                <p className="mb-2">Access, download, and install in accordance with the Documentation the SecureBuild Image and to install the SecureBuild Image on servers owned, leased or controlled by Licensee. All copies of the SecureBuild Image made or distributed (as set forth in Section 2(c)) by the Licensee:</p>
                <ol className="list-decimal ml-6 space-y-1">
                  <li>will be the exclusive property of the Licensor or its licensors;</li>
                  <li>will be subject to the terms and conditions of this Agreement; and</li>
                  <li>must include all trademark, copyright, patent, and other Intellectual Property Rights or other proprietary rights notices contained in the original.</li>
                </ol>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">b) Usage Rights</h3>
                <p>Use and run the SecureBuild Image as properly installed in accordance with this Agreement and the Documentation, solely as set forth in the Documentation and solely for Licensee's internal business purposes.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">c) Distribution to Customers</h3>
                <p>Distribute the SecureBuild Image to Licensee's customers of the Licensee Application and authorize such Licensee customers to utilize the SecureBuild Image in conjunction with the Licensee Application and subject to Licensee's customers agreeing to be bound by license terms consistent with and at least as restrictive as the license terms contained in this Agreement.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">d) Documentation Rights</h3>
                <p className="mb-2">Download the Documentation and use such Documentation, solely in support of its licensed use of the SecureBuild Image in accordance herewith. All copies of the Documentation made by Licensee or its customers:</p>
                <ol className="list-decimal ml-6 space-y-1">
                  <li>will be the exclusive property of Licensor or its licensors;</li>
                  <li>will be subject to the terms and conditions of this Agreement; and</li>
                  <li>must include all copyright, trademark, patent, or other Intellectual Property Rights or other proprietary rights notices contained in the original.</li>
                </ol>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">e) Documentation Distribution</h3>
                <p>Distribute the Documentation to Licensee's customers who have been licensed to use and run the SecureBuild Image as provided in Section 2(c), and to authorize such customers to use the Documentation solely in support of their licensed use of the SecureBuild Image and subject to Licensee's customers agreeing to be bound by license terms consistent with and at least as restrictive as the license terms contained in this Agreement.</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">3. Third-Party Materials</h2>
            <p>The SecureBuild Image may include software, content, data, or other materials, including related documentation, that are owned by Persons other than Licensor and that are provided to Licensee on terms that are in addition to and/or different from those contained in this Agreement (<strong>"Third-Party Licenses"</strong>). A list of all materials, if any, included in the SecureBuild Image and provided under Third-Party Licenses can be found on each image's detail page at <Link href="/dashboard/images" className="text-blue-600 hover:text-blue-800">https://securebuild.com/dashboard/images</Link>, and the applicable Third-Party Licenses are accessible via links therefrom. Licensee is bound by and shall comply with all Third-Party Licenses and shall ensure that all Licensee customers to which Licensee distributes the SecureBuild Image are bound by such Third-Party Licenses. Any breach by Licensee of any Third-Party License is also a breach of this Agreement.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">4. Use Restrictions</h2>
            <p className="mb-4">Licensee shall not directly or indirectly:</p>
            <ol className="list-decimal ml-6 space-y-2">
              <li>use (including make any copies of) the SecureBuild Image or Documentation beyond the scope of the license granted under Sections 2 and 3;</li>
              <li>provide any other Person other than its authorized Representatives and customers properly licensed in accordance with this Agreement with access to or use of the SecureBuild Image or Documentation;</li>
              <li>use or distribute the SecureBuild Image on a stand-alone basis or for use with any other product or service other than the Licensee Application as distributed in conjunction with the Distribution Solution;</li>
              <li>modify, translate, adapt, or otherwise create derivative works or improvements, whether or not patentable, of the SecureBuild Image or Documentation or any part thereof;</li>
              <li>reverse engineer, disassemble, decompile, decode, or otherwise attempt to derive or gain access to the source code of the SecureBuild Image or any part thereof except as may be provided in applicable Third-Party Licenses and with respect to the software, content, data, or other materials that are subject to the applicable Third-Party Licenses;</li>
              <li>remove, delete, alter, or obscure any trademarks or any copyright, trademark, patent, or other intellectual property or proprietary rights notices provided on or with the SecureBuild Image or Documentation, including any copy thereof;</li>
              <li>except as expressly set forth in Sections 2(a) through 2(d), copy the SecureBuild Image or Documentation, in whole or in part;</li>
              <li>except as explicitly authorized herein, rent, lease, lend, sell, sublicense, assign, distribute, publish, transfer, or otherwise make available the SecureBuild Image, or any features or functionality of the SecureBuild Image, to any Third Party for any reason, whether or not over a network or on a hosted basis, including in connection with the internet or any web hosting, wide area network (WAN), virtual private network (VPN), virtualization, time-sharing, service bureau, software as a service, cloud, or other technology or service;</li>
              <li>use the SecureBuild Image or Documentation in violation of any law, regulation, or rule; or</li>
              <li>use the SecureBuild Image or Documentation for purposes of competitive analysis of the SecureBuild Image, the development of a competing software product or service, or any other purpose that is to the Licensor's commercial disadvantage.</li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">5. Limited Licenses</h2>
            <p>The licenses provided are limited licenses, and Licensee acknowledges that this Agreement does not grant Licensee, and Licensor expressly disclaims the grant of any license, immunity or other right to or under any patent or other Intellectual Property Right of Licensor, whether directly or by implication, legal or equitable estoppel, exhaustion or otherwise, except for the limited licenses expressly granted herein.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">6. Responsibility for Use of SecureBuild Image</h2>
            <p>Licensee is responsible and liable for all uses of the SecureBuild Image and Documentation through access thereto provided by Licensee, directly or indirectly. Specifically, and without limiting the generality of the foregoing, Licensee is responsible and liable for all actions and failures to take required actions with respect to the SecureBuild Image and Documentation by Licensee or its Representatives or by any other Person to whom Licensee may provide access to or use of the SecureBuild Image and/or Documentation, whether such access or use is permitted by or in violation of this Agreement.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">7. Compliance Measures</h2>
            <p>Upon request, Licensee shall certify in writing to Licensor that it is in compliance with the license terms and restrictions of this Agreement. Licensor, or its duly appointed auditor, may inspect and audit Licensee's use of the SecureBuild Image and Documentation to confirm compliance with the terms of this Agreement, with at least seven (7) day's prior written notice at any time during the Subscription Term and for six months following the termination or earlier expiration of the Agreement. Licensee shall make available all books, records, equipment, information, and personnel, and provide such cooperation and assistance as is reasonably requested by Licensor or its duly appointed auditor with respect to such audit. If the audit determines that Licensee's access and use of the SecureBuild Image and Documentation is not in compliance with this Agreement, Licensor shall notify Licensee and Licensee shall immediately take steps to cure any non-compliance. In the event of any material non-compliance, in addition to its other remedies available at law or in equity, whether under this Agreement or otherwise, Licensee shall be responsible for Licensor's reasonable audit expenses.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">8. Service Level Agreement</h2>
            <p>During the Subscription Term, Licensor will provide Updates to the SecureBuild Image in accordance with its Service Level Agreement at <Link href="/customer-sla" className="text-blue-600 hover:text-blue-800">securebuild.com/customer-sla/</Link>. The SLA is incorporated into this Agreement by reference.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">9. SecureBuild Catalog</h2>
            <p>Licensee acknowledges that, in addition the licensing of the SecureBuild Image through the SecureBuild Site, Licensor may offer licenses to the SecureBuild Image as part of subscriptions to bundles of SecureBuild images that are available as part of its SecureBuild image catalog. Unless Licensee has opted out from receiving communications regarding Licensor's SecureBuild's catalog via the SecureBuild Site, Licensee consents to Licensor contacting Licensee with respect to its catalog.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">10. Intellectual Property Rights</h2>
            <p>Licensee acknowledges and agrees that the SecureBuild Image and Documentation are provided under license, and not sold, to Licensee. Licensee does not acquire any ownership interest in the SecureBuild Image or Documentation under this Agreement, or any other rights thereto, other than to use the same in accordance with the license granted and subject to all terms, conditions, and restrictions under this Agreement. Licensor and its licensors and service providers reserve and shall retain its and their entire right, title, and interest in and to the SecureBuild Image and all Intellectual Property Rights arising out of or relating to the SecureBuild Image, except as expressly granted to the Licensee in this Agreement. Licensee shall use commercially reasonable efforts to safeguard the SecureBuild Image (including all copies thereof) from infringement, misappropriation, theft, misuse, or unauthorized access. Licensee shall promptly notify Licensor if Licensee becomes aware of any infringement of the Licensor's Intellectual Property Rights in the SecureBuild Image or violation of Third-Party Licenses, and fully cooperate with Licensor, at Licensor's sole expense, in any legal action taken by Licensor to enforce its Intellectual Property Rights.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">11. Payments</h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">a) Payment Terms</h3>
                <p>All Fees are payable in advance in the manner set forth in the Order Form and are non-refundable. As of the Effective Date, Licensor offers annual or multi-year subscriptions that are paid for on an annual basis in advance of the annual subscription period, or if a monthly payment option is selected, will be paid monthly at the beginning of each successive month during the Subscription Term. Payments are automatically made via the credit card that Licensee has provided as of the Effective Date. Licensee authorizes Licensor to charge its credit card in accordance with the payment option selected in the Order Form. Licensee understands and acknowledges that the licenses and rights granted in this Agreement with respect to the SecureBuild Image and Documentation are subject to the payment of applicable Fees.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">b) Taxes</h3>
                <p>Licensee is responsible for the payment of all taxes that might be assessed against Licensee in any jurisdiction. Licensee shall pay or reimburse Licensor for all value-added, sales, use, property and similar taxes; all customs duties, import fees, stamp duties, licensee fees and similar charges; and all other mandatory payments to government agencies of whatever kind, except taxes imposed on the net or gross income of Licensor. All amounts payable to Licensor under this Agreement shall be without set-off and without deduction of any taxes, levies, imposts, charges, withholdings and/or duties of any nature which may be levied or imposed, including without limitation, value added tax, customs duty and withholding tax.</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">12. Term and Termination</h2>
            <div className="space-y-4 ml-4">
              <div>
                <h3 className="font-semibold mb-2">a) Term</h3>
                <p>This Agreement and the subscription licenses granted hereunder shall remain in effect for the Subscription Term set forth on the Order Form or until earlier terminated as set forth herein (the <strong>"Term"</strong>).</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">b) Termination by Licensee</h3>
                <p>Licensee may terminate this Agreement by ceasing to use and destroying all copies of the SecureBuild Image and Documentation.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">c) Termination for Breach</h3>
                <p>Licensor may terminate this Agreement, effective upon written notice to Licensee, if Licensee, materially breaches this Agreement and such breach: (i) is incapable of cure; or (ii) being capable of cure, remains uncured thirty (30) days after Licensor provides written notice thereof.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">d) Termination for Insolvency</h3>
                <p>Licensor may terminate this Agreement, effective immediately, if Licensee files, or has filed against it, a petition for voluntary or involuntary bankruptcy or pursuant to any other insolvency law, makes or seeks to make a general assignment for the benefit of its creditors or applies for, or consents to, the appointment of a trustee, receiver, or custodian for a substantial part of its property.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">e) Effect of Termination</h3>
                <p>Upon expiration or earlier termination of this Agreement, the subscription license granted hereunder shall also terminate, and Licensee shall cease using and destroy all copies of the SecureBuild Image and Documentation. No expiration or termination shall affect Licensee's obligation to pay all Fees that may have become due before such expiration or termination, or entitle Licensee to any refund.</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">13. Warranty Disclaimer</h2>
            <div className="bg-gray-100 p-6 rounded-lg">
              <p className="text-sm font-medium uppercase tracking-wide">
                THE SECUREBUILD IMAGE AND DOCUMENTATION ARE PROVIDED TO LICENSEE "AS IS" AND WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. TO THE MAXIMUM EXTENT PERMITTED UNDER APPLICABLE LAW, LICENSOR, ON ITS OWN BEHALF AND ON BEHALF OF ITS AFFILIATES AND ITS AND THEIR RESPECTIVE LICENSORS AND SERVICE PROVIDERS, EXPRESSLY DISCLAIMS ANY AND ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, WITH RESPECT TO THE SECUREBUILD IMAGE AND DOCUMENTATION, INCLUDING WITHOUT LIMITATION, ANY AND ALL WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, SATISFACTORY QUALITY, OR NON-INFRINGEMENT OF THIRD PARTY RIGHTS, OR WARRANTIES THAT MAY ARISE OUT OF COURSE OF DEALING, COURSE OF PERFORMANCE, USAGE, OR TRADE PRACTICE. WITHOUT LIMITATION TO THE FOREGOING, LICENSOR PROVIDES NO WARRANTY OR UNDERTAKING, AND MAKES NO REPRESENTATION OF ANY KIND THAT THE SECUREBUILD IMAGE OR DOCUMENTATION WILL MEET LICENSEE'S REQUIREMENTS, ACHIEVE ANY INTENDED RESULTS, BE COMPATIBLE, OR WORK WITH ANY OTHER SOFTWARE, APPLICATIONS, SYSTEMS, OR SERVICES, OPERATE WITHOUT INTERRUPTION, MEET ANY PERFORMANCE OR RELIABILITY STANDARDS OR BE ERROR FREE, OR THAT ANY ERRORS OR DEFECTS CAN OR WILL BE CORRECTED. LICENSOR STRICTLY DISCLAIMS ALL WARRANTIES WITH RESPECT TO ANY THIRD-PARTY MATERIALS.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">14. Limitation of Liability</h2>
            <div className="bg-gray-100 p-6 rounded-lg">
              <p className="text-sm font-medium uppercase tracking-wide mb-4">TO THE FULLEST EXTENT PERMITTED UNDER APPLICABLE LAW:</p>
              
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">a) Exclusion of Damages</h3>
                  <p className="text-sm">IN NO EVENT WILL LICENSOR OR ITS AFFILIATES, OR ANY OF ITS OR THEIR RESPECTIVE LICENSORS OR SERVICE PROVIDERS, BE LIABLE TO LICENSEE OR ANY THIRD PARTY FOR ANY USE, INTERRUPTION, DELAY, OR INABILITY TO USE THE SECUREBUILD IMAGE OR DOCUMENTATION; LOST REVENUES OR PROFITS; DELAYS, INTERRUPTION, OR LOSS OF SERVICES, BUSINESS, OR GOODWILL; LOSS OR CORRUPTION OF DATA; LOSS RESULTING FROM SYSTEM OR SYSTEM SERVICE FAILURE, MALFUNCTION, OR SHUTDOWN; FAILURE TO ACCURATELY TRANSFER, READ, OR TRANSMIT INFORMATION; FAILURE TO UPDATE OR PROVIDE CORRECT INFORMATION; SYSTEM INCOMPATIBILITY OR PROVISION OF INCORRECT COMPATIBILITY INFORMATION; OR BREACHES IN SYSTEM SECURITY; OR FOR ANY CONSEQUENTIAL, INCIDENTAL, INDIRECT, EXEMPLARY, SPECIAL, OR PUNITIVE DAMAGES, WHETHER ARISING OUT OF OR IN CONNECTION WITH THIS AGREEMENT, BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, REGARDLESS OF WHETHER SUCH DAMAGES WERE FORESEEABLE AND WHETHER OR NOT THE LICENSOR WAS ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
                </div>
                
                <div>
                  <h3 className="font-semibold mb-2">b) Liability Cap</h3>
                  <p className="text-sm">IN NO EVENT WILL LICENSOR'S AND ITS AFFILIATES', INCLUDING ANY OF ITS OR THEIR RESPECTIVE LICENSORS' AND SERVICE PROVIDERS', COLLECTIVE AGGREGATE LIABILITY UNDER OR IN CONNECTION WITH THIS AGREEMENT OR ITS SUBJECT MATTER, UNDER ANY LEGAL OR EQUITABLE THEORY, INCLUDING BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, AND OTHERWISE, EXCEED THE TOTAL AMOUNT OF SUBSCRIPTION FEES FOR THE SECUREBUILD IMAGE PAID TO THE LICENSOR PURSUANT TO THIS AGREEMENT FOR THE THREE (3) MONTHS IMMEDIATELY PRIOR TO THE EVENT GIVING RISE TO THE LIABILITY.</p>
                </div>
                
                <div>
                  <h3 className="font-semibold mb-2">c) Application of Limitations</h3>
                  <p className="text-sm">THE LIMITATIONS SET FORTH IN SECTION 14(a) AND SECTION 14(b) SHALL APPLY EVEN IF THE LICENSEE'S REMEDIES UNDER THIS AGREEMENT FAIL OF THEIR ESSENTIAL PURPOSE.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">15. Export Regulation</h2>
            <p>Licensee shall not export, re-export, import, use, transfer, distribute, or access the SecureBuild Image except in compliance with applicable laws and regulations of the relevant government authorities, including U.S. export control and sanction regulations. Licensee warrants that it shall not allow access to or use of the SecureBuild Image in embargoed or sanctioned countries or regions, by sanctioned or denied persons, or for prohibited end-uses under applicable law. If any part of the SecureBuild Image or Documentation is deemed to be licensed by the U.S. government, including any U.S. federal agency, the SecureBuild Image and Documentation is considered a "commercial item" as that term is defined in FAR 2.101 (and as it is defined and used in all corresponding agency specific Federal Acquisition Regulation supplements) and developed at private expense and is provided with only those rights specified herein.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4">16. Miscellaneous</h2>
            <div className="space-y-4 ml-4">
              <div>
                <h3 className="font-semibold mb-2">a) Governing Law</h3>
                <p>All matters arising out of or relating to this Agreement shall be governed by and construed in accordance with the laws of the State of California without giving effect to any choice or conflict of law provision or rule. Any legal suit, action, or proceeding arising out of or relating to this Agreement or the transactions contemplated hereby shall be instituted in the federal courts of the United States of America or the courts of the State of California in each case located in the County of Los Angeles, and each party irrevocably submits to the exclusive jurisdiction of such courts in any such legal suit, action, or proceeding. The parties irrevocably consent to service of process by mail or in any other manner permitted by applicable law.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">b) Force Majeure</h3>
                <p>In no event shall Licensor be liable to Licensee, or be deemed to have breached this Agreement, for any failure or delay in performing its obligations under this Agreement, if and to the extent such failure or delay is caused by any circumstances beyond Licensor's reasonable control, including but not limited to: (i) acts of God; (ii) flood, fire, earthquake, epidemic, or explosion; (iii) war, invasion, hostilities (whether war is declared or not), terrorist threats or acts, riot or other civil unrest; (iv) government order, law, or actions; (v) embargoes or blockades in effect on or after the date of this Agreement; (vi) national or regional emergency; (vii) strikes, labor stoppages or slowdowns, or other industrial disturbances; and (viii) shortage of adequate power or transportation facilities.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">c) Notices</h3>
                <p>All notices, requests, consents, claims, demands, waivers, and other communications hereunder shall be in writing and shall be deemed to have been given: (i) when delivered by hand (with written confirmation of receipt); (ii) when received by the addressee if sent by a nationally recognized overnight courier (receipt requested); (iii) on the date sent by facsimile or email (with confirmation of transmission) if sent during normal business hours of the recipient, and on the next business day if sent after normal business hours of the recipient; or (iv) on the third day after the date mailed, by certified or registered mail, return receipt requested, postage prepaid. Such communications must be sent to the respective parties at the addresses set forth on the Order Form (or to such other address as may be designated by a party from time to time in accordance with this Section 16(c).</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">d) Entire Agreement</h3>
                <p>This Agreement, together with the Order Form, all exhibits attached hereto, and all other documents that are incorporated by reference herein constitutes the sole and entire agreement between Licensee and Licensor with respect to the subject matter contained herein, and supersedes all prior and contemporaneous understandings, agreements, representations, and warranties, both written and oral, with respect to such subject matter.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">e) Assignment</h3>
                <p>Licensee shall not assign or otherwise transfer any of its rights, or delegate or otherwise transfer any of its obligations or performance, under this Agreement, in each case whether voluntarily, involuntarily, by operation of law, or otherwise, without Licensor's prior written consent, which consent Licensor may give or withhold in its sole discretion. No delegation or other transfer will relieve Licensee of any of its obligations or performance under this Agreement. Any purported assignment, delegation, or transfer in violation of this Section 16(e) is void. Licensor may freely assign or otherwise transfer all or any of its rights, or delegate or otherwise transfer all or any of its obligations or performance, under this Agreement without Licensee's consent. This Agreement is binding upon and inures to the benefit of the parties hereto and their respective permitted successors and assigns.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">f) No Third Party Beneficiaries</h3>
                <p>This Agreement is for the sole benefit of the parties hereto and their respective successors and permitted assigns and nothing herein, express or implied, is intended to or shall confer on any other Person any legal or equitable right, benefit, or remedy of any nature whatsoever under or by reason of this Agreement.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">g) Amendment and Waiver</h3>
                <p>This Agreement may only be amended, modified, or supplemented by an agreement in writing signed by each party hereto. No waiver by any party of any of the provisions hereof shall be effective unless explicitly set forth in writing and signed by the party so waiving. Except as otherwise set forth in this Agreement, no failure to exercise, or delay in exercising, any right, remedy, power, or privilege arising from this Agreement shall operate or be construed as a waiver thereof; nor shall any single or partial exercise of any right, remedy, power, or privilege hereunder preclude any other or further exercise thereof or the exercise of any other right, remedy, power, or privilege.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">h) Severability</h3>
                <p>If any term or provision of this Agreement is invalid, illegal, or unenforceable in any jurisdiction, such invalidity, illegality, or unenforceability shall not affect any other term or provision of this Agreement or invalidate or render unenforceable such term or provision in any other jurisdiction.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">i) Interpretation</h3>
                <p>For purposes of this Agreement, (a) the words "include," "includes," and "including" shall be deemed to be followed by the words "without limitation"; (b) the word "or" is not exclusive; and (c) the words "herein," "hereof," "hereby," "hereto," and "hereunder" refer to this Agreement as a whole. Unless the context otherwise requires, references herein: (x) to Sections, Schedules, and Exhibits refer to the Sections of, and Schedules, and Exhibits attached to, this Agreement; (y) to an agreement, instrument, or other document means such agreement, instrument, or other document as amended, supplemented, and modified from time to time to the extent permitted by the provisions thereof and (z) to a statute means such statute as amended from time to time and includes any successor legislation thereto and any regulations promulgated thereunder. This Agreement shall be construed without regard to any presumption or rule requiring construction or interpretation against the party drafting an instrument or causing any instrument to be drafted. The Order Form referred to herein shall be construed with, and as an integral part of, this Agreement to the same extent as if they were set forth verbatim herein.</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">j) Language</h3>
                <p>The headings in this Agreement are for reference only and do not affect the interpretation of this Agreement.</p>
              </div>
            </div>
          </section>

          <div className="border-t pt-8 mt-12">
            <p className="text-sm text-gray-600 text-center">
              This agreement incorporates the <Link href="/customer-sla" className="text-blue-600 hover:text-blue-800">SecureBuild Customer Service Level Agreement</Link> by reference.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
} 