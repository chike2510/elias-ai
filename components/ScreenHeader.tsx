import Link from "next/link";
import { ChevronLeft } from "lucide-react";
export default function ScreenHeader({title, back="/"}:{title:string; back?:string}) {
  return <div className="screen-title"><Link href={back} className="back"><ChevronLeft size={21}/></Link><span>{title}</span></div>;
}