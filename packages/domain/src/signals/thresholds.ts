/**
 * Seuils des signaux « Actions à prendre ».
 * Source : catalogue des signaux (Notion). « v1 » = repris du code de la v1,
 * « proposition » = à valider par Dali avant la bêta.
 */
export interface SignalThresholds {
  /** C1, proposition : leads de la veille encore non traités. */
  c1MinUntreated: number;
  /** C2, proposition : fenêtre de calcul du taux de confirmation et des stats agents. */
  confirmWindowDays: number;
  /** C2, v1 (ProductObjective.targetConfirmRate) : objectif par défaut si le produit n'en a pas. */
  defaultConfirmRatePct: number;
  /** C2/C3 : volume minimal de leads pour qu'un taux soit significatif. */
  minLeads: number;
  /** C3, v1 (agentGoalConfirmGlobalRate). */
  agentConfirmRatePct: number;
  /** C3, v1 (agentGoalDailyConfirmed). */
  agentDailyConfirmed: number;
  /** C4, v1 (agentReturnAlertThreshold). */
  agentReturnRatePct: number;
  /** C4 : colis clos minimum pour juger un agent sur ses retours. */
  agentMinClosedParcels: number;

  /** P1/P2, v1 (ad-bucket) : ratio CPA / CPA cible. */
  adScaleRatio: number;
  /**
   * P1, v1 : au-delà, pub à couper. ad-bucket.ts coupe à 1,6, ad-analyzer à 1,8 :
   * Dali doit choisir une seule grille (voir « Tâches pour Dali »).
   */
  adCutRatio: number;
  /** P1, v1 : dépense sans commande, en multiple du CPA cible. */
  adCutNoOrderRatio: number;
  /** P2, v1 : achats minimum pour scaler. */
  adScaleMinPurchases: number;
  adWindowDays: number;
  /** P2, meeting du 5 octobre : 180 $/jour/produit, converti en millimes (taux 3,1 à confirmer). */
  adDailyCapMinor: number;
  /** P3, v1 (ad-analyzer) : seuils de fatigue créative, 3 derniers jours contre jours 4 à 14. */
  fatigueFrequency: number;
  fatigueCtrDrop: number;
  fatigueCpmRise: number;
  fatigueCpaRise: number;
  fatigueRoasDrop: number;
  fatigueMinSignals: number;
  /** P4, proposition : jours consécutifs au-dessus du CPL de break-even. */
  cplConsecutiveDays: number;

  /** L1, v1 (agentGoalDeliveryRate). */
  deliveryRatePct: number;
  deliveryWindowDays: number;
  /** L1/L2 : colis clos minimum. */
  minClosedParcels: number;
  /** L2, proposition : écart sous la moyenne, en points. */
  zoneGapPoints: number;
  zoneWindowDays: number;
  /** P4 : taux de livraison supposé quand aucun colis n'est encore clos. */
  fallbackDeliveryRatePct: number;

  /** S1, proposition : marge de sécurité ajoutée au délai de réappro. */
  stockMarginDays: number;
  /** S2, proposition. */
  dormantNoSaleDays: number;
  dormantMaxDaysOfStock: number;

  /** R1, proposition : ne juge pas le mois avant ce nombre de jours écoulés. */
  monthMinDays: number;
}

export const DEFAULT_SIGNAL_THRESHOLDS: SignalThresholds = {
  c1MinUntreated: 5,
  confirmWindowDays: 7,
  defaultConfirmRatePct: 60,
  minLeads: 20,
  agentConfirmRatePct: 40,
  agentDailyConfirmed: 10,
  agentReturnRatePct: 30,
  agentMinClosedParcels: 10,

  adScaleRatio: 0.7,
  adCutRatio: 1.6,
  adCutNoOrderRatio: 2,
  adScaleMinPurchases: 3,
  adWindowDays: 7,
  adDailyCapMinor: 558_000,
  fatigueFrequency: 2.6,
  fatigueCtrDrop: 0.85,
  fatigueCpmRise: 1.15,
  fatigueCpaRise: 1.25,
  fatigueRoasDrop: 0.8,
  fatigueMinSignals: 3,
  cplConsecutiveDays: 3,

  deliveryRatePct: 70,
  deliveryWindowDays: 14,
  minClosedParcels: 20,
  zoneGapPoints: 15,
  zoneWindowDays: 30,
  fallbackDeliveryRatePct: 70,

  stockMarginDays: 3,
  dormantNoSaleDays: 14,
  dormantMaxDaysOfStock: 90,

  monthMinDays: 7,
};
