# Aircraft photo overrides

Drop a photo here named after the tail number to use it on `/logbook`
instead of the aircraft's MyFlightbook photo:

    N30126.jpg      (also .jpeg, .png, .webp; case doesn't matter)
    N30126.txt      optional caption, e.g. "Photo by me"; no .txt = no caption

Then run `python3 scripts/mfb_sync.py sync` (or let CI do it). Aircraft
without an override keep using the auto-downloaded photo in `../auto/`,
which the sync manages; don't put anything there by hand.
