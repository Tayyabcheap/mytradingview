//+------------------------------------------------------------------+
//|                                           MyFinanceAdvisor_SMC.mq5 |
//|                                  Copyright 2026, MyFinanceAdvisor  |
//|                    Smart Money Concepts (SMC) & Liquidity Sweeps |
//+------------------------------------------------------------------+
#property copyright "MyFinanceAdvisor (@Tradewithrakhi)"
#property link      "https://myfinanceadvisor.com"
#property version   "1.00"
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   2

// Plot settings for Signals
#property indicator_label1  "Bullish Buy Signal"
#property indicator_type1   DRAW_ARROW
#property indicator_color1  clrLimeGreen
#property indicator_width1  3

#property indicator_label2  "Bearish Sell Signal"
#property indicator_type2   DRAW_ARROW
#property indicator_color2  clrCrimson
#property indicator_width2  3

// Inputs
input group "=== Risk & Target Parameters ==="
input double   InpLotSize              = 0.10;    // Default Lot Size (Max 1.0)
input double   InpRiskRewardTP1        = 1.5;     // TP1 Risk:Reward (75% Close)
input double   InpCTCTriggerPips       = 50.0;    // Cost-to-Cost (CTC) Trigger (Pips)
input double   InpStopLossBufferPoints = 1.5;     // Stop Loss Buffer Behind OB (Points)

input group "=== Session & Trap Filters ==="
input int      InpSessionStartHour     = 6;       // Active Trading Start Hour (UTC)
input int      InpSessionEndHour       = 19;      // Active Trading End Hour (UTC)
input bool     InpEnableSoundAlerts    = true;    // Play Sound & Popup on Signal
input bool     InpDrawOrderBlocks      = true;    // Draw 15M/5M Order Block Boxes
input bool     InpDrawPDHLines         = true;    // Draw Previous Day High/Low Lines

// Buffers
double BuySignalBuffer[];
double SellSignalBuffer[];

// Global Variables
datetime lastAlertTime = 0;
double pdh_level = 0.0;
double pdl_level = 0.0;

//+------------------------------------------------------------------+
//| Custom indicator initialization function                         |
//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, BuySignalBuffer, INDICATOR_DATA);
   SetIndexBuffer(1, SellSignalBuffer, INDICATOR_DATA);

   PlotIndexSetInteger(0, PLOT_ARROW, 233); // Wingdings Up Arrow
   PlotIndexSetInteger(1, PLOT_ARROW, 234); // Wingdings Down Arrow

   IndicatorSetString(INDICATOR_SHORTNAME, "MyFinanceAdvisor_SMC");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Custom indicator deinitialization function                       |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, "Rakhi_");
   Comment("");
}

//+------------------------------------------------------------------+
//| Custom indicator iteration function                              |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   if(rates_total < 50) return(0);

   ArraySetAsSeries(time, true);
   ArraySetAsSeries(open, true);
   ArraySetAsSeries(high, true);
   ArraySetAsSeries(low, true);
   ArraySetAsSeries(close, true);
   ArraySetAsSeries(BuySignalBuffer, true);
   ArraySetAsSeries(SellSignalBuffer, true);

   int limit = rates_total - prev_calculated;
   if(limit > 100) limit = 100;

   // 1. Fetch Daily PDH & PDL
   MqlRates daily_rates[];
   ArraySetAsSeries(daily_rates, true);
   if(CopyRates(_Symbol, PERIOD_D1, 1, 1, daily_rates) > 0)
   {
      pdh_level = daily_rates[0].high;
      pdl_level = daily_rates[0].low;

      if(InpDrawPDHLines)
      {
         DrawHLine("Rakhi_PDH", pdh_level, clrGold, STYLE_DOT, "PDH (Previous Day High)");
         DrawHLine("Rakhi_PDL", pdl_level, clrDodgerBlue, STYLE_DOT, "PDL (Previous Day Low)");
      }
   }

   // 2. Scan Bars for Signals
   for(int i = limit; i >= 1; i--)
   {
      BuySignalBuffer[i] = EMPTY_VALUE;
      SellSignalBuffer[i] = EMPTY_VALUE;

      MqlDateTime dt;
      TimeToStruct(time[i], dt);
      if(dt.hour < InpSessionStartHour || dt.hour > InpSessionEndHour) continue;

      double candle_range = high[i] - low[i];
      if(candle_range <= 0) continue;

      double lower_wick = MathMin(open[i], close[i]) - low[i];
      double upper_wick = high[i] - MathMax(open[i], close[i]);
      double lower_wick_ratio = lower_wick / candle_range;
      double upper_wick_ratio = upper_wick / candle_range;

      // Bullish Sweeps & Rejections
      bool pdl_sweep = (low[i+1] <= pdl_level && close[i] > pdl_level);
      bool bull_reject = (close[i] > open[i] && (lower_wick_ratio >= 0.30 || close[i] > high[i+1]));

      if((pdl_sweep || (low[i] <= pdl_level + 1.0)) && bull_reject)
      {
         BuySignalBuffer[i] = low[i] - (_Point * 20);

         if(i == 1 && time[1] != lastAlertTime)
         {
            lastAlertTime = time[1];
            double sl = low[i] - (InpStopLossBufferPoints * 1.0);
            double risk = close[i] - sl;
            double tp1 = close[i] + (InpRiskRewardTP1 * risk);
            double tp2 = pdh_level > 0 ? pdh_level : (close[i] + 3.5 * risk);

            string msg = StringFormat("[RAKHI SMC BUY] %s @ %.3f | SL: %.3f | TP1 (75%%): %.3f | TP2 (PDH): %.3f | Move SL to CTC at +50 pips",
                                      _Symbol, close[i], sl, tp1, tp2);
            if(InpEnableSoundAlerts)
            {
               Alert(msg);
               PlaySound("alert.wav");
            }
         }
      }

      // Bearish Sweeps & Rejections
      bool pdh_sweep = (high[i+1] >= pdh_level && close[i] < pdh_level);
      bool bear_reject = (close[i] < open[i] && (upper_wick_ratio >= 0.30 || close[i] < low[i+1]));

      if((pdh_sweep || (high[i] >= pdh_level - 1.0)) && bear_reject)
      {
         SellSignalBuffer[i] = high[i] + (_Point * 20);

         if(i == 1 && time[1] != lastAlertTime)
         {
            lastAlertTime = time[1];
            double sl = high[i] + (InpStopLossBufferPoints * 1.0);
            double risk = sl - close[i];
            double tp1 = close[i] - (InpRiskRewardTP1 * risk);
            double tp2 = pdl_level > 0 ? pdl_level : (close[i] - 3.5 * risk);

            string msg = StringFormat("[RAKHI SMC SELL] %s @ %.3f | SL: %.3f | TP1 (75%%): %.3f | TP2 (PDL): %.3f | Move SL to CTC at +50 pips",
                                      _Symbol, close[i], sl, tp1, tp2);
            if(InpEnableSoundAlerts)
            {
               Alert(msg);
               PlaySound("alert.wav");
            }
         }
      }
   }

   // Chart Comment Dashboard
   string comment = "==========================================\n" +
                    " TRADE WITH RAKHI - SMC SYSTEM MONITOR \n" +
                    "==========================================\n" +
                    " Asset: " + _Symbol + "\n" +
                    " PDH (Previous Day High): " + DoubleToString(pdh_level, _Digits) + "\n" +
                    " PDL (Previous Day Low):  " + DoubleToString(pdl_level, _Digits) + "\n" +
                    " CTC Rule: Move SL to Entry at +50 Pips\n" +
                    " Profit Scaling: Close 75% at TP1 | 25% Runner\n" +
                    "==========================================";
   Comment(comment);

   return(rates_total);
}

//+------------------------------------------------------------------+
//| Helper to draw horizontal lines                                 |
//+------------------------------------------------------------------+
void DrawHLine(string name, double price, color clr, ENUM_LINE_STYLE style, string text)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   }
   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, text);
}
