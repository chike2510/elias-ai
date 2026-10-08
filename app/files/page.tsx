import { Suspense } from "react";
import FilesScreen from "@/components/screens/FilesScreen";

export default function Page() { return <Suspense fallback={null}><FilesScreen /></Suspense>; }
