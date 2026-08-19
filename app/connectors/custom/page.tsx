"use client";

import { useSearchParams } from "next/navigation";
import CustomConnectorScreen from "@/components/screens/CustomConnectorScreen";

export default function CustomConnectorPage() {
  const params = useSearchParams();
  return <CustomConnectorScreen type={params.get("type") || "custom_api"} />;
}
