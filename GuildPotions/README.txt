GUILD POTIONS v0.2 - automated potion orders for guild makers
=========================================================

Fills orders from https://zlem-eq.github.io/pages/guild-potions.html :
pulls the orders assigned to you, buys the ingredients, makes the potions
in your medicine bag, parcels them from the Bazaar, and marks each order
Complete on the guild page.


REQUIREMENTS
------------
- MacroQuest (VanillaMQ / RedGuides launcher)
- MQ2Nav with meshes for Shadow Haven and The Bazaar
- MQ2EasyFind (used for /travelto)
- A shaman with high Alchemy and a Medicine Bag in a main bag slot
- Deepwater Ink in your bags if you'll make distillates (it's a drop, not sold)


INSTALL
-------
1. Unzip so the "guildpotions" folder lands inside your MacroQuest lua folder:
       ...\VanillaMQ_LIVE\lua\guildpotions\init.lua   <- should end up here
2. In game, on your alchemist:
       /lua run guildpotions
3. In the window, pick your name from the Maker dropdown.


USING IT
--------
Refresh Orders     - loads open orders assigned to your maker name
Buy Ingredients    - travels to the merchants and buys only what's missing
Make Potions       - searches each recipe in the tradeskill window and presses Combine
                     until the order is filled; re-buys and continues if failed
                     combines leave you short. Recipes you've never made fall back
                     to placing the ingredients one at a time.
Parcel & Complete  - goes to the Bazaar, parcels each order, marks it Complete on the page
Do All             - all of the above in order
Stop               - interrupts whatever is running

Settings in the window:
- Buy at: Shadow Haven now; switch to Plane of Knowledge once PoK is open on your server
- Pause RGMercs while working
- Parcel step delay: raise it if parceling fails because the game is slow to respond
- Combine step delay: raise it if combining skips ahead or stalls

Uncheck an order in the list to leave it out of a run.
Don't click around in game while it's working.

Stop the script:  /lua stop guildpotions


UPDATING
--------
Replace the files in lua\guildpotions with the new ones. Your settings and the
merchant stock it has learned are saved separately in your MacroQuest config
folder (guildpotions_*.lua), so they're kept.


TROUBLESHOOTING
---------------
- Every action writes a timestamped line in the window's Messages box.
  If something fails, screenshot that box and send it to Bingling.
- "Could not load orders": your PC couldn't reach the guild page's database.
- "No known seller" or "enemy drop - bring it" in the ingredient list tells you
  what it can't buy for you.
- A brief black console window flashes when it talks to the guild page. That's normal.
