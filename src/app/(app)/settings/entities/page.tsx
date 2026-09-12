import { Landmark } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import {
  BANK_KIND_LABELS,
  BRIDGE_MODE_LABELS,
  listBridgeAccountChoices,
  listBridgeRules,
  listEntitiesWithBankAccounts,
  listUnlinkedBankLedgerAccounts,
  TAX_FORM_LABELS,
} from "@/lib/org/entities";
import { formatDate, isoDate } from "@/lib/format";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityDialog } from "@/components/settings/entities/entity-dialog";
import { BankAccountDialog } from "@/components/settings/entities/bank-account-dialog";
import { BankAccountActiveButton } from "@/components/settings/entities/bank-account-active-button";
import { BridgeRuleDialog } from "@/components/settings/entities/bridge-rule-dialog";

export const metadata = { title: "Entities & bank accounts" };

export default async function EntitiesSettingsPage() {
  const user = await requireFullSession("/settings/entities");
  const canEdit = hasFullAccess(user.role);
  const [entities, unlinked, rules, accountChoices] = await Promise.all([
    listEntitiesWithBankAccounts(db),
    listUnlinkedBankLedgerAccounts(db),
    listBridgeRules(db),
    listBridgeAccountChoices(db),
  ]);
  const activeEntities = entities.filter((e) => e.isActive);
  const pairs = activeEntities.flatMap((payer) =>
    activeEntities.filter((r) => r.id !== payer.id).map((receiver) => ({ payer, receiver })),
  );

  return (
    <div>
      <PageHeader
        title="Entities & bank accounts"
        helper="The businesses the books are kept for, and the bank accounts each one owns. 544 Liberty and 176 Tulsk are classes under SREI, not entities, so adding an entity is rare."
        actions={
          canEdit ? (
            <EntityDialog
              trigger={
                <Button variant="outline" size="sm">
                  Add entity
                </Button>
              }
            />
          ) : null
        }
      />
      {!canEdit ? (
        <p className="text-muted-foreground mb-4 text-sm">
          You can view these settings. Only the Owner and Full-access users can change them.
        </p>
      ) : null}

      {entities.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No entities yet"
          description="Run the seed to create SREI and PLA, or add an entity here."
        />
      ) : (
        <div className="space-y-6">
          {entities.map((entity) => (
            <Card key={entity.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="text-muted-foreground font-mono text-sm">{entity.code}</span>
                  <span>{entity.name}</span>
                  <StatusChip status={entity.isActive ? "ACTIVE" : "INACTIVE"} />
                </CardTitle>
                <CardDescription>
                  {entity.legalName ?? "No legal name recorded"} · {TAX_FORM_LABELS[entity.taxForm]}
                </CardDescription>
                {canEdit ? (
                  <CardAction className="flex items-center gap-2">
                    <EntityDialog
                      entity={{
                        id: entity.id,
                        code: entity.code,
                        name: entity.name,
                        legalName: entity.legalName,
                        taxForm: entity.taxForm,
                        isActive: entity.isActive,
                      }}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      }
                    />
                    {entity.isActive ? (
                      <BankAccountDialog
                        entityId={entity.id}
                        entityCode={entity.code}
                        unlinked={unlinked}
                        trigger={
                          <Button variant="outline" size="sm">
                            Add bank account
                          </Button>
                        }
                      />
                    ) : null}
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                {entity.bankAccounts.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
                    No bank accounts yet.{" "}
                    {canEdit
                      ? "Use “Add bank account” to link a ledger account in the 1100 group."
                      : ""}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">Ledger</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Institution</TableHead>
                          <TableHead>Kind</TableHead>
                          <TableHead className="text-right">Last 4</TableHead>
                          <TableHead>Opened</TableHead>
                          <TableHead>Closed</TableHead>
                          <TableHead>Status</TableHead>
                          {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entity.bankAccounts.map((b) => (
                          <TableRow
                            key={b.id}
                            className={b.isActive ? undefined : "text-muted-foreground"}
                          >
                            <TableCell className="tabular font-medium">
                              {b.account.number}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{b.name}</div>
                              <div className="text-muted-foreground text-xs">{b.account.name}</div>
                            </TableCell>
                            <TableCell>{b.institution ?? "—"}</TableCell>
                            <TableCell>{BANK_KIND_LABELS[b.kind]}</TableCell>
                            <TableCell className="tabular text-right">{b.last4 ?? "—"}</TableCell>
                            <TableCell className="tabular">
                              {b.openedOn ? formatDate(b.openedOn) : "—"}
                            </TableCell>
                            <TableCell className="tabular">
                              {b.closedOn ? formatDate(b.closedOn) : "—"}
                            </TableCell>
                            <TableCell>
                              <StatusChip status={b.isActive ? "ACTIVE" : "INACTIVE"} />
                            </TableCell>
                            {canEdit ? (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <BankAccountDialog
                                    entityId={entity.id}
                                    entityCode={entity.code}
                                    unlinked={unlinked}
                                    bankAccount={{
                                      id: b.id,
                                      accountNumber: b.account.number,
                                      accountName: b.account.name,
                                      name: b.name,
                                      institution: b.institution,
                                      kind: b.kind,
                                      last4: b.last4,
                                      openedOn: isoDate(b.openedOn) || null,
                                      closedOn: isoDate(b.closedOn) || null,
                                    }}
                                    trigger={
                                      <Button variant="ghost" size="sm">
                                        Edit
                                      </Button>
                                    }
                                  />
                                  <BankAccountActiveButton
                                    id={b.id}
                                    label={`${b.account.number} ${b.name}`}
                                    isActive={b.isActive}
                                  />
                                </div>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Cross-entity bridge rules</CardTitle>
          <CardDescription>
            When one business&apos;s bank pays for something that belongs to another (for example
            the SREI account paying a Providence expense), the app adds two lines so each business
            balances on its own. The default treats the money as having moved through Jose: the
            payer records a capital distribution, the receiver a capital contribution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pairs.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
              Bridge rules appear once there are at least two active entities.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payer → receiver</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Payer line</TableHead>
                    <TableHead>Receiver line</TableHead>
                    {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pairs.map(({ payer, receiver }) => {
                    const rule = rules.find(
                      (r) => r.payerEntityId === payer.id && r.receiverEntityId === receiver.id,
                    );
                    return (
                      <TableRow key={`${payer.id}-${receiver.id}`}>
                        <TableCell className="font-medium">
                          {payer.code} → {receiver.code}
                        </TableCell>
                        <TableCell>
                          {rule ? (
                            BRIDGE_MODE_LABELS[rule.mode]
                          ) : (
                            <span className="text-muted-foreground">
                              Not set — distribution / contribution is assumed
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular">
                          {rule ? `Dr ${rule.payerAccount.number} ${rule.payerAccount.name}` : "—"}
                        </TableCell>
                        <TableCell className="tabular">
                          {rule
                            ? `Cr ${rule.receiverAccount.number} ${rule.receiverAccount.name}`
                            : "—"}
                        </TableCell>
                        {canEdit ? (
                          <TableCell className="text-right">
                            <BridgeRuleDialog
                              payer={{ id: payer.id, code: payer.code }}
                              receiver={{ id: receiver.id, code: receiver.code }}
                              accounts={accountChoices}
                              rule={
                                rule
                                  ? {
                                      mode: rule.mode,
                                      payerAccountId: rule.payerAccountId,
                                      receiverAccountId: rule.receiverAccountId,
                                    }
                                  : undefined
                              }
                              trigger={
                                <Button variant="ghost" size="sm">
                                  {rule ? "Edit" : "Set"}
                                </Button>
                              }
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
