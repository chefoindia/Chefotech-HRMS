// src/screens/SalaryScreen.js
//
// Pay, on the shared layout (contract: src/components/ui/Screen.js).
//
// The composition: the most recent payslip is what anyone opens this tab for,
// so it takes a `strong` panel and the page's one commit control instead of
// sitting as row one of an even list. Everything before it is a quiet list of
// hairline-separated rows, each of which downloads on tap.
//
// The expo-print payslip pipeline below (handleDownload and its HTML) is
// untouched — it renders the same document the HR dashboard does, and the
// markup is deliberately plain-table so the PDF paginates predictably.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from '../lib/api';
import {
  Screen,
  Glass,
  Figure,
  StatusTag,
  PrimaryAction,
  InlineAction,
} from '../components/ui';
import { tap } from '../lib/feedback';
import { useTheme, spacing, type } from '../theme';

export default function SalaryScreen() {
  const { user, apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const userId = user?._id || user?.id;

  const fetchHistory = useCallback(async () => {
    if (!userId) { setError('Employee ID not found. Try logging out and back in.'); setLoading(false); return; }
    setError('');
    try {
      const res = await apiFetch(getApiUrl(`/payslip/${userId}/history`));
      if (res.success) setHistory(res.data || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [userId, apiFetch]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  const onRefresh = async () => { setRefreshing(true); await fetchHistory(); setRefreshing(false); };

  const fmtINR = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleDownload = async (item) => {
    if (!userId) return;
    setDownloading(`${item.year}-${item.month}`);
    try {
      const res = await apiFetch(getApiUrl(`/payslip/${userId}?month=${item.month}&year=${item.year}`));
      if (!res.success) { Alert.alert('Error', res.message || 'Failed'); return; }
      const d = res.data;
      const { company, period, employee, attendance, summary, earnings, deductions, employerContributions } = d;

      // ── Build earnings & deductions rows (side-by-side, matching HR dashboard) ──
      const rowCount = Math.max(earnings.length, deductions.length, 1);
      let edHTML = '';
      for (let i = 0; i < rowCount; i++) {
        const e = earnings[i], dd = deductions[i];
        edHTML += `<tr>
          <td class="c">${e?.label || ''}</td>
          <td class="c r">${e ? fmtINR(e.amount) : ''}</td>
          <td class="c">${dd?.label || ''}</td>
          <td class="c r">${dd ? fmtINR(dd.amount) : ''}</td>
        </tr>`;
      }

      // ── Employer contributions section ──
      let empContribHTML = '';
      if (employerContributions?.epf > 0 || employerContributions?.esic > 0) {
        empContribHTML = `<table><thead><tr><th class="c" colspan="2">Employer Contributions (not deducted from salary)</th></tr></thead><tbody>`;
        if (employerContributions.epf > 0) empContribHTML += `<tr><td class="c" style="width:70%">Employer PF Contribution</td><td class="c r" style="width:30%">${fmtINR(employerContributions.epf)}</td></tr>`;
        if (employerContributions.esic > 0) empContribHTML += `<tr><td class="c">Employer ESIC Contribution</td><td class="c r">${fmtINR(employerContributions.esic)}</td></tr>`;
        empContribHTML += `</tbody></table>`;
      }

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 14mm 12mm; font-size: 11px; line-height: 1.35; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .c { border: 1px solid #000; padding: 4px 6px; font-size: 11px; vertical-align: top; }
  .r { text-align: right; }
  th.c { font-weight: bold; text-align: left; background: #fff; }
</style></head><body>

<!-- Header -->
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
  <div style="width:100px;text-align:center;flex-shrink:0;display:flex;flex-direction:column;align-items:center">
    <div style="width:90px;height:90px;display:flex;align-items:center;justify-content:center">
      <img src="https://cms.grav.in/grav-image-logo.svg" alt="Logo" style="width:80px;height:80px;object-fit:contain" onerror="this.style.display='none'" />
    </div>
    <p style="font-size:7px;font-weight:bold;color:#7c3aed;margin:3px 0 0;letter-spacing:0.3px">GRAV CLOTHING (OPC) PVT LTD</p>
  </div>
  <div style="flex:1;text-align:center">
    <h1 style="font-size:22px;font-weight:bold;margin:0;letter-spacing:0.5px">Grav Clothing (OPC) Pvt Ltd</h1>
    <h2 style="font-size:15px;font-weight:bold;margin:2px 0 0">Payslip for the Month ${period.label}</h2>
  </div>
</div>

<!-- Employee Info -->
<table><tbody>
  <tr><td class="c" style="width:18%"><b>Name</b></td><td class="c" style="width:32%">${employee.name || ''}</td><td class="c" style="width:18%"><b>PAN No</b></td><td class="c" style="width:32%">${employee.panNo || ''}</td></tr>
  <tr><td class="c"><b>Emp No</b></td><td class="c">${employee.empNo || ''}</td><td class="c"><b>PF No</b></td><td class="c">${employee.pfNo || ''}</td></tr>
  <tr><td class="c"><b>Pay Period</b></td><td class="c">${employee.payPeriod || ''}</td><td class="c"><b>UAN No</b></td><td class="c">${employee.uanNo || ''}</td></tr>
  <tr><td class="c"><b>DOJ</b></td><td class="c">${employee.doj || ''}</td><td class="c"><b>ESI No</b></td><td class="c">${employee.esiNo || ''}</td></tr>
  <tr><td class="c"><b>DOB</b></td><td class="c">${employee.dob || ''}</td><td class="c"><b>Department</b></td><td class="c">${employee.department || ''}</td></tr>
  <tr><td class="c"><b>Bank Name</b></td><td class="c">${employee.bankName || ''}</td><td class="c"><b>Designation</b></td><td class="c">${employee.designation || ''}</td></tr>
  <tr><td class="c"><b>Bank A/C No</b></td><td class="c">${employee.bankAccountNo || ''}</td><td class="c"><b>Total Worked Days</b></td><td class="c">${attendance?.payableDays || 0} / ${attendance?.workingDays || 31}</td></tr>
</tbody></table>

<!-- Summary Strip -->
<table><thead><tr>
  <th class="c" style="width:33.33%">Gross Earnings</th>
  <th class="c" style="width:33.33%">Deduction</th>
  <th class="c" style="width:33.34%">Net Pay</th>
</tr></thead><tbody><tr>
  <td class="c">${fmtINR(summary.grossEarnings)}</td>
  <td class="c">${fmtINR(summary.totalDeduction)}</td>
  <td class="c" style="font-weight:bold">${fmtINR(summary.netPay)}</td>
</tr></tbody></table>

<!-- Earnings & Deductions -->
<table><thead><tr>
  <th class="c" style="width:35%">Earnings</th>
  <th class="c r" style="width:15%">Amount</th>
  <th class="c" style="width:35%">Deductions</th>
  <th class="c r" style="width:15%">Amount</th>
</tr></thead><tbody>
  ${edHTML}
  <tr>
    <td class="c" style="font-weight:bold">Total Earnings</td>
    <td class="c r" style="font-weight:bold">${fmtINR(summary.grossEarnings)}</td>
    <td class="c" style="font-weight:bold">Total Deduction</td>
    <td class="c r" style="font-weight:bold">${fmtINR(summary.totalDeduction)}</td>
  </tr>
  <tr>
    <td class="c" colspan="2"></td>
    <td class="c" style="font-weight:bold">Take Home Pay</td>
    <td class="c r" style="font-weight:bold">${fmtINR(summary.takeHomePay || summary.netPay)}</td>
  </tr>
</tbody></table>

<!-- Employer Contributions -->
${empContribHTML}

<p style="font-size:10px;color:#666;margin-top:20px">This Payslip is computer generated and does not require any signature</p>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Payslip - ${item.label}` });
    } catch (e) { Alert.alert('Error', e.message || 'Failed'); } finally { setDownloading(null); }
  };

  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  const latest = history[0];
  const latestKey = latest ? `${latest.year}-${latest.month}` : null;

  return (
    <Screen
      title="Pay"
      subtitle="View and download your salary slips."
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* The latest payslip is what anyone opens this tab for, so it gets
          the weight instead of sitting as row one of an even list. */}
      {latest ? (
        <Glass strong>
          <View style={s.latestHead}>
            <Text style={s.latestLabel} numberOfLines={1}>{latest.label}</Text>
            {latest.status === "paid" ? (
              // `on` names the surface this tag is mixed against — this panel
              // is `strong`, so the tint has to be resolved over glassStrong.
              <StatusTag label="Paid" tone="success" on="glassStrong" />
            ) : null}
          </View>

          <Figure value={inr(latest.netPay)} large style={s.latestNet} />

          <Text style={s.latestSub}>
            Gross {inr(latest.gross)} · Deductions {inr(latest.deductions)}
          </Text>

          {/* The page's one commit control. PrimaryAction carries the press
              spring, the haptic tick and the busy spinner, so the screen does
              not hand-roll a button surface. */}
          <PrimaryAction
            label="Download payslip"
            loading={downloading === latestKey}
            onPress={() => handleDownload(latest)}
            icon={<Ionicons name="download-outline" size={16} color={colors.onHero} />}
            style={s.dl}
          />
        </Glass>
      ) : null}

      {error ? (
        <Glass>
          <View style={s.errHead}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text style={s.errTitle}>Could not load payslips</Text>
            <View style={s.flex} />
            <InlineAction label="Retry" tone="accent" onPress={fetchHistory} />
          </View>
          <Text style={s.muted}>{error}</Text>
        </Glass>
      ) : null}

      {loading ? (
        <View style={s.loadBox}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : history.length === 0 ? (
        // Only when there is nothing to say instead — an error already
        // explains the empty page, and two panels saying it is one too many.
        error ? null : (
          <Glass>
            <Text style={s.emptyTitle}>No payslips yet</Text>
            <Text style={s.muted}>
              Payslips appear here after HR processes payroll.
            </Text>
          </Glass>
        )
      ) : history.length > 1 ? (
        <Glass label="Earlier" padded={false} style={s.listPanel}>
          {history.slice(1).map((item, i) => {
            const key = `${item.year}-${item.month}`;
            const busy = downloading === key;
            return (
              <Glass.Row key={key} first={i === 0}
                onPress={() => { tap(); handleDownload(item); }}>
                <View style={s.rowText}>
                  <View style={s.rowTitle}>
                    <Text style={s.rowLabel} numberOfLines={1}>{item.label}</Text>
                    {item.status === "paid" ? (
                      <StatusTag label="Paid" tone="success" />
                    ) : null}
                  </View>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    Gross {inr(item.gross)} · Ded {inr(item.deductions)}
                  </Text>
                </View>
                <Figure value={inr(item.netPay)} />
                {busy ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="download-outline" size={16} color={colors.textFaint} />
                )}
              </Glass.Row>
            );
          })}
        </Glass>
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    muted: { ...type.body, color: colors.textMuted },

    loadBox: { paddingVertical: spacing.deck, alignItems: "center" },

    errHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      marginBottom: spacing.hair,
    },
    errTitle: { ...type.title, color: colors.danger },

    emptyTitle: { ...type.title, color: colors.text, marginBottom: spacing.hair },

    latestHead: { flexDirection: "row", alignItems: "center", gap: spacing.tight },
    latestLabel: { ...type.title, color: colors.textMuted, flex: 1 },
    // figureLarge, not display: the page title already owns the one display
    // step on this view, and this is a headline number rather than a heading.
    latestNet: { marginTop: spacing.tight },
    latestSub: { ...type.caption, color: colors.textMuted, marginTop: spacing.hair },
    dl: { marginTop: spacing.base },

    listPanel: { paddingVertical: spacing.hair },
    row: { paddingHorizontal: spacing.base },
    rowText: { flex: 1 },
    rowTitle: { flexDirection: "row", alignItems: "center", gap: spacing.tight },
    rowLabel: { ...type.title, color: colors.text, flexShrink: 1 },
    rowMeta: { ...type.caption, color: colors.textFaint, marginTop: 1 },
  });
