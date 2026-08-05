/**
 * A pool of fictional, food-themed Italian mob nicknames for the cars.
 *
 * The dealer removes a name as soon as it is handed out, so a run never sees the
 * same nickname twice while there are names left in the pool.
 */
export const ITALIAN_MOB_NAMES = [
  "Sal Stromboli",
  "Freddie Meatballs",
  "Tony Mozzarella",
  "Vito Calzone",
  "Luca Linguini",
  "Joey Gnocchi",
  "Bruno Balsamico",
  "Marco Marinara",
  "Enzo Espresso",
  "Nino Nocciola",
  "Carlo Cannoli",
  "Rocco Ricotta",
  "Gino Gabagool",
  "Frankie Focaccia",
  "Angelo Anchovy",
  "Dino Diavolo",
  "Benny Biscotti",
  "Paolo Pepperoni",
  "Nico Nutella",
  "Sammy Salsiccia",
  "Cesare Cacciatore",
  "Matteo Meatball",
  "Fabio Farfalle",
  "Gianni Gelato",
  "Sergio Soppressata",
  "Mario Maccheroni",
  "Piero Parmigiano",
  "Tommy Tiramisu",
  "Rico Rigatoni",
  "Aldo Arancini",
  "Guido Gorgonzola",
  "Stefano Stracciatella",
  "Vinnie Vermicelli",
  "Massimo Minestrone",
  "Lorenzo Lasagna",
  "Mimmo Bruschetta",
  "Renzo Ravioli",
  "Beppe Bolognese",
  "Tito Tartufino",
  "Ciro Ciabatta",
  "Raffaele Red Pepper",
  "Salvatore Scamorza",
  "Umberto Umbrian",
  "Peppe Pesto",
  "Otello Orzo",
  "Cosimo Cavatappi",
  "Gabriele Gamberi",
  "Dante Ditalini",
  "Vincenzo Ziti",
  "Don Calamari",
] as const;

export class MobNameDealer {
  private available: string[] = [...ITALIAN_MOB_NAMES];
  private extras = 0;

  next(): string {
    if (this.available.length > 0) {
      const index = Math.floor(Math.random() * this.available.length);
      return this.available.splice(index, 1)[0];
    }

    // A run normally ends before the 50-name pool does. Keep the no-repeat
    // promise even in a marathon run with a unique, still-on-theme fallback.
    this.extras += 1;
    return "Don Nobody " + this.extras;
  }
}
