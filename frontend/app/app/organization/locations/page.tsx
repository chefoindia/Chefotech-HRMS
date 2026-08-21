"use client";

import { MapPin } from "lucide-react";
import { useSession } from "@/lib/session";
import { humanise } from "@/lib/format";
import { NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import type { Location } from "@/lib/types";

export default function LocationsPage() {
  const { can } = useSession();

  if (!can("location.view")) return <NoAccessState what="work locations" />;

  return (
    <MasterDataPage<Location>
      title="Work locations"
      description="Offices, plants and sites. A location can carry its own timezone and holiday calendar, which is what makes a company with offices in two countries work correctly."
      resource="/locations"
      queryKey="locations"
      entityName="Location"
      can={can}
      permissions={{ view: "location.view", manage: "location.manage" }}
      emptyIcon={<MapPin className="h-6 w-6" />}
      emptyDescription="Add the places your people work from."
      columns={[
        {
          key: "name",
          header: "Location",
          sortable: true,
          render: (row) => (
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.name}</p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">
                {[row.address?.city, row.address?.state].filter(Boolean).join(", ") || "—"}
              </p>
            </div>
          ),
        },
        {
          key: "code",
          header: "Code",
          render: (row) => <span className="font-mono text-[12.5px]">{row.code}</span>,
        },
        { key: "type", header: "Type", hideBelow: "sm", render: (row) => humanise(row.type) },
        {
          key: "timezone",
          header: "Timezone",
          hideBelow: "lg",
          render: (row) => row.timezone || "Organization default",
        },
        {
          key: "employeeCount",
          header: "People",
          align: "right",
          render: (row) => row.employeeCount || 0,
        },
      ]}
      fields={[
        { path: "name", label: "Name", required: true, placeholder: "Kochi Head Office" },
        { path: "code", label: "Code", required: true, placeholder: "HO" },
        {
          path: "type",
          label: "Type",
          type: "select",
          options: [
            "head_office",
            "branch",
            "factory",
            "warehouse",
            "site",
            "remote",
            "client_site",
          ].map((value) => ({ value, label: humanise(value) })),
        },
        {
          path: "timezone",
          label: "Timezone",
          placeholder: "Leave blank to use the organization's",
          hint: "Attendance for people here is calculated in this zone.",
        },
        { path: "address.line1", label: "Address", colSpan: 2 },
        { path: "address.city", label: "City" },
        { path: "address.state", label: "State" },
        { path: "address.postalCode", label: "Postal code" },
        { path: "contactPerson", label: "Contact person" },
        {
          path: "geo.latitude",
          label: "Latitude",
          type: "number",
          hint: "Only needed if you restrict web check-in to this site.",
        },
        { path: "geo.longitude", label: "Longitude", type: "number" },
        {
          path: "geo.radiusMetres",
          label: "Geofence radius (metres)",
          type: "number",
          min: 20,
          max: 5000,
        },
      ]}
      defaults={{ type: "branch", isActive: true, geo: { radiusMetres: 200 } }}
    />
  );
}
