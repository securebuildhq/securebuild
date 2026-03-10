"use client"

import { useState, use, useMemo } from "react"
import React from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Shield, ArrowLeft, CreditCard, User, Check, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useSession } from "@/app/hooks/use-session"
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import {loadStripe} from '@stripe/stripe-js/pure';
import { createCheckoutSessionAction } from '@/lib/checkout/actions/create-checkout-session';
import { refreshSubscriptionAction } from '@/lib/checkout/actions/refresh-subscription';
import { CatalogItem } from "@/lib/types/catalog"
import { getCatalogItemAction } from "@/lib/catalog/actions/get-catalog-item";

// Disable advanced fraud signals for E2E testing (reduces bot detection in headless mode)
// See: https://docs.stripe.com/disputes/prevention/advanced-fraud-detection
loadStripe.setLoadParameters({ advancedFraudSignals: false });
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// Define props for the new PaymentForm component
interface PaymentFormProps {
  slug: string;
  clientSecret: string;
  intentType: 'payment' | 'setup';
  setStep: React.Dispatch<React.SetStateAction<"details" | "payment" | "processing" | "success" | "error">>;
  setPaymentError: React.Dispatch<React.SetStateAction<string | null>>;
  paymentError: string | null;
  onPaymentSuccess: (paymentIntentId: string | null) => void;
}

const PaymentFormComponent: React.FC<PaymentFormProps> = ({
  slug,
  clientSecret,
  intentType,
  setStep,
  setPaymentError,
  paymentError,
  onPaymentSuccess
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const handlePayment = async () => {
    if (!termsAccepted) {
      return;
    }

    if (!stripe || !elements || !clientSecret) {
      setPaymentError("Stripe.js has not loaded yet or client secret is missing.");
      setStep("error");
      return;
    }

    const paymentElement = elements.getElement("payment");
    if (!paymentElement) {
      setPaymentError("Payment Element is not available. Please ensure it has loaded correctly.");
      setStep("error");
      return;
    }

    setIsSubmitting(true);
    setPaymentError(null);

    if (intentType === 'setup') {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/${slug}?setup_intent_client_secret=${clientSecret}`,
        },
        redirect: "if_required"
      });

      if (error) {
        if (error.type === "card_error" || error.type === "validation_error") {
          setPaymentError(error.message || "An unexpected error occurred with your card.");
        } else {
          setPaymentError(error.message || "An unexpected setup error occurred.");
        }
        setStep("payment");
        setIsSubmitting(false);
      } else if (setupIntent) {
        switch (setupIntent.status) {
          case "succeeded":
            onPaymentSuccess(setupIntent.id);
            setStep("success");
            break;
          case "processing":
            setStep("processing");
            break;
          case "requires_action":
            setPaymentError("Further action is required to set up your payment method. Please follow the prompts from Stripe.");
            setStep("payment");
            break;
          case "requires_payment_method":
            setPaymentError("Setup failed. Please try another payment method.");
            setStep("payment");
            break;
          default:
            setPaymentError(`Unexpected setup status: ${setupIntent.status}`);
            setStep("error");
            break;
        }
        setIsSubmitting(false);
      } else {
        setPaymentError("Setup confirmation did not return an intent or an error. Please try again.");
        setStep("payment");
        setIsSubmitting(false);
      }
    } else {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/${slug}?payment_intent_client_secret=${clientSecret}`,
        },
        redirect: "if_required"
      });

      if (error) {
        if (error.type === "card_error" || error.type === "validation_error") {
          setPaymentError(error.message || "An unexpected error occurred with your card.");
        } else {
          setPaymentError(error.message || "An unexpected payment error occurred.");
        }
        setStep("payment");
        setIsSubmitting(false);
      } else if (paymentIntent) {
        switch (paymentIntent.status) {
          case "succeeded":
            onPaymentSuccess(paymentIntent.id);
            setStep("success");
            break;
          case "processing":
            setStep("processing");
            break;
          case "requires_action":
            setPaymentError("Further action is required to complete your payment. Please follow the prompts from Stripe.");
            setStep("payment");
            break;
          case "requires_payment_method":
            setPaymentError("Payment failed. Please try another payment method.");
            setStep("payment");
            break;
          default:
            setPaymentError(`Unexpected payment status: ${paymentIntent.status}`);
            setStep("error");
            break;
        }
        setIsSubmitting(false);
      } else {
        setPaymentError("Payment confirmation did not return an intent or an error. Please check your payment status or try again.");
        setStep("payment");
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="payment-element">Card Details</Label>
        <PaymentElement
          id="payment-element"
          onReady={() => setIsPaymentElementReady(true)}
        />
      </div>
      {paymentError && <p className="text-sm text-red-600 py-2">{paymentError}</p>}
      <div className="flex items-start space-x-2">
        <Checkbox id="terms" checked={termsAccepted} onCheckedChange={(checked) => setTermsAccepted(checked === true)} />
        <label
          htmlFor="terms"
          className="text-sm font-medium leading-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Customer acknowledges that use of SecureBuild Images is governed by the{" "}
          <Link href="/purchase-terms" className="underline" target="_blank" rel="noopener noreferrer">
            Customer Subscription Agreement
          </Link>{" "}
          and agrees to its terms. By checking this box, I represent and warrant that I am authorized to bind the Customer (my employer) to these terms.
        </label>
      </div>
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" />
        <span>Your payment information is secure and encrypted</span>
      </div>
      <div className="w-full space-y-4 pt-4">
        <Button
          data-testid="checkout-payment-button"
          className="w-full"
          onClick={handlePayment}
          disabled={isSubmitting || !stripe || !elements || !clientSecret || !isPaymentElementReady || !termsAccepted}
        >
          {isSubmitting
            ? "Processing..."
            : intentType === 'setup'
              ? "Set Up Payment Method"
              : "Complete Subscription"
          }
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setStep("details")}
          disabled={isSubmitting}
        >
          Back
        </Button>
      </div>
    </div>
  );
};

export default function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const router = useRouter()
  const { slug } = use(params)
  const [step, setStep] = useState<"details" | "payment" | "processing" | "success" | "error">("details")
  const [isGuest, setIsGuest] = useState(true)
  const [isFetchingClientSecret, setIsFetchingClientSecret] = useState(false)
  const { isSessionLoading, session } = useSession()
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentType, setIntentType] = useState<'payment' | 'setup'>('payment');
  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isProcessingRedirect, setIsProcessingRedirect] = useState(false);
  const [paymentIntentIdForRefresh, setPaymentIntentIdForRefresh] = useState<string | null>(null);
  const [isFreeSubscription, setIsFreeSubscription] = useState(false);

  React.useEffect(() => {
    const fetchCatalogItem = async () => {
      const item = await getCatalogItemAction(session, slug);
      setCatalogItem(item);
    };
    fetchCatalogItem();
  }, [slug, session]);

  React.useEffect(() => {
    if (step === "payment" && session && catalogItem && !clientSecret) {
      setIsFetchingClientSecret(true);
      const getClientSecret = async () => {
        try {
          const result = await createCheckoutSessionAction(session, catalogItem.id, "monthly");
          if (result.isFree) {
            // Free subscription created successfully, skip payment and go to success
            setStep("success");
            setIsFetchingClientSecret(false);
            setIsFreeSubscription(true);
            return;
          }

          if (result.clientSecret) {
            setClientSecret(result.clientSecret);
            setIntentType(result.intentType || 'payment');
          } else {
            console.error("Failed to get client secret: No clientSecret returned from Server Action");
            setPaymentError("Failed to initialize payment. Please try again.");
            setStep("error");
            setClientSecret(null);
          }
        } catch (error: unknown) {
          console.error("Error calling createCheckoutSessionAction:", error);
          let errorMessage = "An unexpected error occurred while initializing payment.";
          if (error instanceof Error && error.message) {
            errorMessage = error.message;
          }
          setPaymentError(errorMessage);
          setStep("error");
          setClientSecret(null);
        }
        setIsFetchingClientSecret(false);
      };
      getClientSecret();
    } else if (step !== 'payment') {
      setClientSecret(null);
      setIntentType('payment');
      setPaymentError(null);
      setIsFreeSubscription(false);
    }
  }, [step, session, catalogItem, slug, clientSecret]);

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return null;
    return {
      clientSecret: clientSecret,
    };
  }, [clientSecret]);

  const handleContinue = () => {
    setPaymentError(null);
    setStep("payment")
  }

  React.useEffect(() => {
    if (!session) {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntentClientSecretFromUrl = urlParams.get('payment_intent_client_secret');
    const setupIntentClientSecretFromUrl = urlParams.get('setup_intent_client_secret');

    if (paymentIntentClientSecretFromUrl || setupIntentClientSecretFromUrl) {
      setIsProcessingRedirect(true);
      loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!).then(stripeInstance => {
        if (!stripeInstance) {
            setPaymentError("Failed to load Stripe to verify payment.");
            setStep("error");
            setIsProcessingRedirect(false);
            return;
        }

        if (paymentIntentClientSecretFromUrl) {
          // Handle payment intent redirect
          stripeInstance.retrievePaymentIntent(paymentIntentClientSecretFromUrl).then(({ paymentIntent, error }) => {
            if (error) {
              setPaymentError("Error retrieving payment status: " + error.message);
              setStep("error");
              router.replace(`/checkout/${slug}`, undefined);
              setIsProcessingRedirect(false);
              return;
            }
            switch (paymentIntent?.status) {
              case "succeeded":
                setPaymentIntentIdForRefresh(paymentIntent.id);
                setStep("success");
                router.replace(`/checkout/${slug}`, undefined);
                break;
              case "processing":
                setStep("processing");
                break;
              case "requires_payment_method":
                setPaymentError("Payment failed. Please try another payment method.");
                setStep("payment");
                router.replace(`/checkout/${slug}`, undefined);
                break;
              default:
                setPaymentError("Something went wrong with your payment. Status: " + paymentIntent?.status);
                setStep("error");
                router.replace(`/checkout/${slug}`, undefined);
                break;
            }
            setIsProcessingRedirect(false);
          }).catch(err => {
            console.error("Error in retrievePaymentIntent catch:", err);
            setPaymentError("An unexpected error occurred while verifying your payment.");
            setStep("error");
            router.replace(`/checkout/${slug}`, undefined);
            setIsProcessingRedirect(false);
          });
        } else if (setupIntentClientSecretFromUrl) {
          // Handle setup intent redirect
          stripeInstance.retrieveSetupIntent(setupIntentClientSecretFromUrl).then(({ setupIntent, error }) => {
            if (error) {
              setPaymentError("Error retrieving setup status: " + error.message);
              setStep("error");
              router.replace(`/checkout/${slug}`, undefined);
              setIsProcessingRedirect(false);
              return;
            }
            switch (setupIntent?.status) {
              case "succeeded":
                setPaymentIntentIdForRefresh(setupIntent.id);
                setStep("success");
                router.replace(`/checkout/${slug}`, undefined);
                break;
              case "processing":
                setStep("processing");
                break;
              case "requires_payment_method":
                setPaymentError("Setup failed. Please try another payment method.");
                setStep("payment");
                router.replace(`/checkout/${slug}`, undefined);
                break;
              default:
                setPaymentError("Something went wrong with your setup. Status: " + setupIntent?.status);
                setStep("error");
                router.replace(`/checkout/${slug}`, undefined);
                break;
            }
            setIsProcessingRedirect(false);
          }).catch(err => {
            console.error("Error in retrieveSetupIntent catch:", err);
            setPaymentError("An unexpected error occurred while verifying your setup.");
            setStep("error");
            router.replace(`/checkout/${slug}`, undefined);
            setIsProcessingRedirect(false);
          });
        }
      });
    }
  }, [slug, router, session]);

  React.useEffect(() => {
    if (!session || step !== 'success' || (!paymentIntentIdForRefresh && !isFreeSubscription)) {
      return;
    }

    const refreshSubscription = async () => {
      await refreshSubscriptionAction(session);
    };

    refreshSubscription();
  }, [step, session, paymentIntentIdForRefresh, isFreeSubscription]);

  if (isSessionLoading || (session && !catalogItem && step !== 'error' && step !== 'success')) {
    return <div>Loading page content...</div>
  }

  const team = session?.teams.find((team) => team.id === session?.selectedTeamId);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <header className="w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-teal-600" />
            <span className="text-xl font-bold">SecureBuild</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href={`/images/${slug}`}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to package
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto max-w-6xl px-4 py-8 md:py-12">
        <div className="flex justify-center mb-8">
          <div className="flex items-center space-x-2">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full ${step === "details" || step === "payment" || step === "processing" || step === "success" || step === "error" ? "bg-teal-600 text-white" : "bg-gray-200 text-gray-500"}`}
            >
              <User className="h-4 w-4" />
            </div>
            <div
              className={`w-12 h-1 ${step === "payment" || step === "processing" || step === "success" || step === "error" ? "bg-teal-600" : "bg-gray-200"}`}
            ></div>
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full ${step === "payment" || step === "processing" || step === "success" || step === "error" ? "bg-teal-600 text-white" : "bg-gray-200 text-gray-500"}`}
            >
              <CreditCard className="h-4 w-4" />
            </div>
            <div className={`w-12 h-1 ${step === "success" || step === "error" ? "bg-teal-600" : "bg-gray-200"}`}></div>
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full ${step === "success" || step === "error" ? "bg-teal-600 text-white" : "bg-gray-200 text-gray-500"}`}
            >
              <Check className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  {step === "details" && (!session || !team) && "Sign in to continue"}
                  {step === "details" && session && team && "Your Details"}
                  {step === "payment" && "Payment Information"}
                  {(step === "processing" || isProcessingRedirect) && "Processing Payment"}
                  {step === "success" && "Payment Successful!"}
                  {step === "error" && "Payment Error"}
                </CardTitle>
                <CardDescription>
                  {step === "details" && (!session || !team) && "Please sign in to complete your subscription"}
                  {step === "details" && session && team && "To edit this information, please visit your Team page."}
                  {step === "payment" && "Enter your payment details to complete your subscription"}
                  {(step === "processing" || isProcessingRedirect) && "Please wait while we process your payment"}
                  {step === "success" && "Your subscription has been activated"}
                  {step === "error" && (paymentError || "An unexpected error occurred during payment.")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {step === "details" && (!session || !team) && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-4">
                    <div className="h-16 w-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                      <User className="h-8 w-8" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-medium">Account required</h3>
                      <p className="text-muted-foreground">
                        You need to sign in to continue with your subscription.
                      </p>
                      <div className="flex gap-3 pt-2 justify-center">
                        <Button onClick={() => router.push(`/login?next=${encodeURIComponent(`/checkout/${slug}`)}`)}>Sign in</Button>
                        <Button variant="outline" onClick={() => router.push(`/signup?next=${encodeURIComponent(`/checkout/${slug}`)}`)}>Create Account</Button>
                      </div>
                    </div>
                  </div>
                )}

                {step === "details" && session && team && (
                  <Tabs
                    defaultValue={isGuest ? "guest" : "login"}
                    onValueChange={(value) => setIsGuest(value === "guest")}
                  >
                    <TabsContent value="guest">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="first-name">First Name</Label>
                            <Input id="first-name" value={session?.user?.firstName} readOnly />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="last-name">Last Name</Label>
                            <Input id="last-name" value={session?.user?.lastName} readOnly />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" type="email" value={session?.user?.email} readOnly />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="company">Company (Optional)</Label>
                          <Input id="company" value={session?.teams[0].name} readOnly />
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="login">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="login-email">Email</Label>
                          <Input id="login-email" type="email" placeholder="john.doe@example.com" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="password">Password</Label>
                          <Input id="password" type="password" />
                        </div>
                        <div className="text-sm text-right">
                          <Link href="#" className="text-teal-600 hover:text-teal-700">
                            Forgot password?
                          </Link>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                )}

                {step === "payment" && (!session || !team) && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-4">
                    <div className="h-16 w-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                      <User className="h-8 w-8" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-medium">Account required</h3>
                      <p className="text-muted-foreground">
                        You need to sign in to continue with your subscription.
                      </p>
                      <div className="flex gap-3 pt-2 justify-center">
                        <Button onClick={() => router.push(`/login?next=${encodeURIComponent(`/checkout/${slug}`)}`)}>Sign in</Button>
                        <Button variant="outline" onClick={() => router.push(`/signup?next=${encodeURIComponent(`/checkout/${slug}`)}`)}>Create Account</Button>
                      </div>
                    </div>
                  </div>
                )}

                {step === "payment" && session && team && (
                  isFetchingClientSecret || !clientSecret || !elementsOptions ? (
                    <div className="py-8 flex flex-col items-center justify-center space-y-4">
                      <div className="h-12 w-12 border-4 border-t-teal-600 border-teal-600/30 rounded-full animate-spin"></div>
                      <p className="text-center text-muted-foreground">
                        {isFetchingClientSecret ? "Fetching payment details..." : "Preparing payment form..."}
                        {!session && " Please sign in to proceed."}
                        {paymentError && <span className="block text-red-600 pt-2">Error: {paymentError}</span>}
                      </p>
                    </div>
                  ) : (
                    <Elements options={elementsOptions} stripe={stripePromise}>
                      <PaymentFormComponent
                        slug={slug}
                        clientSecret={clientSecret}
                        intentType={intentType}
                        setStep={setStep}
                        setPaymentError={setPaymentError}
                        paymentError={paymentError}
                        onPaymentSuccess={setPaymentIntentIdForRefresh}
                      />
                    </Elements>
                  )
                )}

                {(step === "processing" || isProcessingRedirect) && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-4">
                    <div className="h-12 w-12 border-4 border-t-teal-600 border-teal-600/30 rounded-full animate-spin"></div>
                    <p className="text-center text-muted-foreground">
                      Please wait while we process your payment. Do not close this window.
                    </p>
                  </div>
                )}

                {step === "success" && catalogItem && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-4">
                    <div className="h-16 w-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center">
                      <Check className="h-8 w-8" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-medium">
                        {isFreeSubscription
                          ? "Welcome to your free subscription!"
                          : "Thank you for your subscription!"
                        }
                      </h3>
                      <p className="text-muted-foreground">
                        {isFreeSubscription
                          ? `Your free ${catalogItem.name} SecureBuild subscription has been activated.`
                          : `Your ${catalogItem.name} SecureBuild subscription has been activated.`
                        }
                      </p>
                      <div className="pt-4">
                        <Button data-testid="checkout-success-button" onClick={() => router.push("/dashboard/images")}>Go to my images</Button>
                      </div>
                    </div>
                  </div>
                )}
                {step === "error" && (
                  <div className="py-8 flex flex-col items-center justify-center space-y-4">
                    <div className="h-16 w-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                      <Shield className="h-8 w-8" />
                    </div>
                    <div className="text-center space-y-2">
                      <h3 className="text-xl font-medium">Payment Failed</h3>
                      <p className="text-muted-foreground">
                        {paymentError || "We encountered an issue processing your payment. Please try again or contact support."}
                      </p>
                      <Button onClick={() => {
                        setPaymentError(null);
                        if (clientSecret) setStep("payment");
                        else setStep("details");
                      }}>Try Again</Button>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                {step === "details" && session && team && (
                  <div className="w-full">
                    <Button data-testid="checkout-continue-button" className="w-full" onClick={handleContinue} disabled={isFetchingClientSecret || !session}>
                      {catalogItem && catalogItem.pricing.monthly === 0
                        ? "Complete Free Subscription"
                        : "Continue to Payment"
                      }
                    </Button>
                  </div>
                )}
              </CardFooter>
            </Card>
          </div>

          {catalogItem && (
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Order Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center space-x-4">
                    <div className="h-16 w-16 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <Image
                        src={"/placeholder.svg"}
                        width={40}
                        height={40}
                        alt={`${catalogItem.name} logo`}
                        className="rounded-sm"
                      />
                    </div>
                    <div>
                      <h3 className="font-medium">{catalogItem.name} SecureBuild</h3>
                      <p className="text-sm text-muted-foreground">
                        {catalogItem.pricing.monthly === 0
                          ? "Free Subscription"
                          : "Monthly Subscription"
                        }
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-medium text-lg">
                    <span>Total</span>
                    <span>
                      {catalogItem.pricing.monthly === 0
                        ? "Free"
                        : `$${catalogItem.pricing.monthly}/month`
                      }
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>
                      {catalogItem.pricing.monthly === 0
                        ? "This is a free subscription. No payment required."
                        : "Your subscription will renew automatically each month. You can cancel anytime from your account settings."
                      }
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                    <Shield className="h-4 w-4 text-teal-600" />
                    <span>70% of your subscription goes directly to the project maintainers</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>

      <footer className="py-6 border-t">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} SecureBuild. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
