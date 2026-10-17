# Sources for preset terms

Every preset is synthetic: the LPs, dates and amounts are invented. Where a preset's **terms**
follow a public document, it's recorded here.

## Clean European fund (ILPA-style terms)

- **Source:** ILPA Model Limited Partnership Agreement (whole-of-fund version), waterfall clause 14.3.3,
  as summarized by Osborne Clarke ("ILPA's model LPA – just a conversation starter?") and Mayer Brown
  (analysis of the ILPA Model Fund Agreement, May 2020).
- **What we took:** European whole-of-fund structure, 8% preferred return, 80:20 GP catch-up
  (a bracketed, negotiable figure in the model), 20% carried interest.
- **What we assumed:** annual compounding of the pref. The summaries we read don't specify it.
- **Not modelled:** escrow (clause 14.7.1) and the deemed contribution date when a subscription line is
  used. Clawback (clause 14.7.2) is modelled for American waterfalls since M4.

Links:
- https://www.osborneclarke.com/insights/model-lpa-just-conversation-starter/
- https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2020/05/ilpa-model-fund-agreement_v2.pdf

## Public data: Advent International GPE VI-A, Avista Capital Partners III

- **Source:** Oregon State Treasury, *OPERF Private Equity Portfolio, as of December 31, 2024*
  ($ in millions). https://www.oregon.gov/treasury/invested-for-oregon/Documents/Invested-for-OR-Performance-and-Holdings/2024/OPERF_Private_Equity_Portfolio_-_Quarter_4_2024.pdf
- **What we took, as printed:** vintage, capital commitment, total capital contributed, total capital
  distributed, fair market value, total value multiple, IRR. The report states its figures are **net of
  fees**. The values are in `src/scenarios/public.ts`.
- **How funds were chosen:** mostly or fully realized, not marked as sold on the secondary market (the
  report says those figures aren't representative), and not managed by the author's employer.
- **What we assumed:** dated cash flows (a typical buyout calling and distribution pattern) and terms
  (1.5% on commitments for 6 years, then 1% on invested capital; 8% hurdle, 100% catch-up, 20% carry,
  European). Neither fund's LPA or cash-flow dates are public.
- **How the reconstruction works:** `src/scenarios/calibrate.ts` searches for the investment, gross
  distributions, gross NAV and timing that make the engine reproduce the published net contributed,
  distributed, remaining value and IRR. `tests/calibration.test.ts` checks the fit.
- **Caveats from the source:** the report warns that its IRRs are not approved by the GPs and should not
  be used to judge or compare funds. The reconstructions here are teaching examples, **not** estimates
  of these funds' actual gross performance or terms.
