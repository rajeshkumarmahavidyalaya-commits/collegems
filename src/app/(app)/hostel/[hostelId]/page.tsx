import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BedDouble } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hostelKindLabel } from "@/lib/validations/hostel";
import { getRegister, listHostels } from "../actions";
import { HostelRegister } from "./hostel-register";

export const metadata = { title: "Hostel register" };

export default async function HostelRegisterPage({
  params,
}: {
  params: Promise<{ hostelId: string }>;
}) {
  const { hostelId } = await params;
  const [hostels, register] = await Promise.all([listHostels(), getRegister(hostelId)]);

  const hostel = hostels.find((h) => h.id === hostelId);
  if (!hostel) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{hostel.name}</h1>
            <Badge variant="outline">{hostelKindLabel(hostel.kind)}</Badge>
            {!hostel.isActive && <Badge variant="secondary">Closed</Badge>}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BedDouble className="size-3.5" aria-hidden="true" />
              {hostel.occupied} of {hostel.beds} beds
            </span>
            <span>{hostel.roomCount} rooms</span>
            <span>{hostel.wardenName ? `Warden: ${hostel.wardenName}` : "No warden recorded"}</span>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All hostels
          </Link>
        </Button>
      </div>

      <HostelRegister hostelName={hostel.name} rows={register} />
    </div>
  );
}
