import { Suspense } from "react";
import Onboarding from "@/components/Onboarding";

export default function WelcomePage() {
  return <Suspense fallback={null}><Onboarding /></Suspense>;
}
