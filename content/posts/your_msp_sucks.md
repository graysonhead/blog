+++
title = "Your Managed Service Provider Sucks"
date = 2019-10-24
[taxonomies]
  tags = [ "MSP", "Managed Service Provider", "Business" ]
+++

One of the best jobs I ever had was at a small local managed service provider and software development firm. The constant customer interaction, plethora of technical challenges with insufficient manpower to fix them, and the companies desire to actually make money turned my coworkers and I into some of the most well-rounded IT engineers I’ve ever met. Yes, we can design you a public cloud on Vmware, Cloudstack, or Openstack. Sure, we can set up BGP edge routing for you. You need some basic programming done to integrate two products with sane APIs? Sure thing. And somehow we still found room to store gems such as “How to Read a P&L”, “Contract Writing 101”, and “How to Convince People to Sign 6 Figure Checks”.

Before you think that I’m writing this just to gasconade, I was far from the only employee that had a story like this. The secret sauce in our ability to step into an unfamiliar situation and get shit done, was that we were constantly in an unfamiliar situation. And we lived in an environment that had us near constantly in an unfamiliar or uncomfortable situation. We were the people that showed up when the single IT guy for a medium sized company was out of ideas, and we were the people that showed up to a new customer without backups that just lost data that essentially comprised their company, and we were the people that showed up after one of your IT people went rouge and tried to do as much damage as possible on the way out. Our world was filled with constant stress and worry that this might be the time our ability to read a manual and keep a cool head would finally fail us. Occasionally it did.

At the time, I hated it. There was no stability, no rest, and an endless torrent of other peoples problems that I had never seen before. But if I could go back and change anything about my career, I wouldn’t change my time at MSPs (but I also wouldn’t go back). It helped that I had a pair of amazing mentors, one of whom was a seasoned Systems Engineer/Programmer, and the other one happened to own the company. It was the perfect launchpad for my college-free career path, it was like rocket fuel for my career.

If you have the opportunity to work at an MSP, you should. Its experience that money can’t buy. But this article isn’t targeted at people who are looking for jobs, this article is targeted at people who are either currently running, or thinking about running MSPs.

All told now, I’ve lived at MSPs for a little less than a decade. I’ve worked for the big and small, old and new, great and horrible. I worked at one for 6 + years, and I’ve also worked for 3 at the same time. I’ve been everything from Tier 1 help-desk to manager to director. All told, if you count little stints of contracting here and there, I’ve either contracted or worked for about 8 different MSPs.

Without early and intentional intervention, even a successful MSP will have a tendency to fall into the “traps” I’m about to outline. If you are thinking about starting an MSP, pay close attention. I’m about to give you a glimpse into your future, and believe me, it sucks.

## You Aren't Charging Enough, But You Can't Charge Enough

Any kind of outsourcing is a race to the bottom. Standard rates for normal per-head tech support now is around $45–70 per person per month. This is less than most people’s cell phone bills. And granted, I’m talking remote-only basic computer support, but this is the bread and butter of most MSPs. When each of your customer’s employees is demanding a half an hour of your time on average each month (and this is probably a little low for the typical customer that would hire an MSP in the first place), you are talking about dollars of profit per head after the employee helping the customer gets paid. So the only thing you can do is start adding on services. A few years ago, this would actually get you a pretty decent living. Most tech companies had a serious bottleneck regarding marketing and sales, and they would give you 20–30% margins just to introduce their email platform, antivirus software, or productivity suite to your customers. And for hardware sales, the margins were often bigger. I remember selling a customer 50 computers at a 47% margin as a result of a few concurrent promotions our distributor was doing. That damn near covered the operating cost for that MSP for 2 months. But nowadays? You are lucky if you see 5%. And its hardly free money, you have to work at it. The amount of “mailbox money” you are getting from any modern SaaS company that you sell into your customer base is probably going to offset the cost of postage, but not much more.

So unless you are able to push datacenter gear in large quantities, where 20–25% margins are still realistic, this isn’t going to net you any profits. At best, it might help you close the gap between MRR and operational costs, but in all honesty its probably going to be more of a distraction than anything.

## You Need to Use the Same Contract for ALL of Your Customers

This is by far one of the most important things you can do to offset the MSP pain. If one of your customers doesn’t want to get on board, drop them.

You can design a contract that is just flexible enough, while also allowing you to standardize how you get paid, and how you provide services for your customers. My recommendation would be to create a document that outlines all of your services, and then have a separate form specific to each customer that lays out which of those services they have purchased for you. Its super easy. You are generally going to wind up with a 3 tier “basic — essential — premium” sort of model. And there is going to be a standard distribution of customers across these three tiers, with most picking essential and a few big fish picking premium. And those big fish are where you are actually going to make some money. But don’t worry, you are going to spend all that money you just made trying to acquire more customers like them.

The most important reason for this, is consistency. Your employees need to understand how you make money, and they need to understand what they are and aren’t allowed to do for the customer without having to get a check. You can’t expect them to remember the special snowflake contract for each of your customers, and you can’t expect them to look it up every time Sally from Accounting at that underfunded non-profit needs help changing her toner cartridge. Any time they spend doing overhead tasks is time they aren’t spending making your customers happy.

## If Your Operational Costs Aren’t Covered by Your Recurring Revenue, Your Time Is Limited

This one is pretty simple. If you can’t find a way to cover your operational costs with your recurring revenue, you are going to struggle and flail every month selling more labor than you have to try and cover the gap. That works for a few months, but eventually you accumulate more promises than you have people to fulfill them, and then you are screwed with no way out. Don’t do this. Cover your MRR from the start, when your operational costs are small, and don’t expand till you have MRR to cover the expansion.

And for heaven’s sake, make your MRR customers sign contracts. The term doesn’t have to be ridiculously long, but you need time to find replacement customers if one of your big fish decides to leave.


# A Better Model

## Write an Operations Manual

Unless you hate taking vacations.

If you write it good enough, and you hire the right people, your training will consist of you handing it to people. For everyone else, it serves as an unambiguous reference in situations where you would normally get a phone call at a funeral and be “that uncle”.

## Your First Employee (Ideally You) Should Be a Programmer

MSPs are tech companies, and MSPs require high operational efficiency. The kind of operational efficiency you aren’t going to get by buying off the shelf generic software. By the time you get around to hiring your first few Technicians, you should damn well know exactly what your workflow looks like. And you should then go and create workflow automation tools that fit that workflow like a glove. Then just keep building. Make a customer portal (it makes you look way more professional than your competitors with generically branded Connectwise portals), and then integrate it with everything you sell. A customer should be able to log into a website and see all existing tickets, incidents, upcoming bills, and all of the services they can buy from you. Make it easy, and make it completely unambiguous. Ambiguity is what kills operational efficiency, and workflow automation software kills ambiguity.

But this is a 10,000ft view. You could write a book on what I’ve said above. All I’ll say is; if you don’t know how to do it, find someone that does. But I’ll also say that if you have to find someone that knows how to do it, you should probably consider a different career unless you have a large pile of money you want to light on fire.

## Revolving Door Hiring

This is the most difficult thing, and the most worthwhile thing. You need to build your company in a way that it is accepting of entry level technicians, and give them just enough guard rails to help them get started, but not enough that they feel restricted. Find people that have built their own computers, find people that have modded video games, find people that use Linux (even if you are a windows shop.) Hire exclusively on three factors; Are they self-driven? Do they like learning new skills? Do they dress and speak presentably?

Eventually you are going to reach a point where your employees out-learn the position they occupy. Due to the nature of MSPs, you probably won’t have grown enough to offer your first few senior employees the positions that are worthy of their new skill-sets. What you do at this moment is critical, many people will stretch and find money to promote their first employees to positions that don’t exist, and that the business can’t justify. Don’t do it. Give them the most glowing letter of recommendation ever, and don’t fire them before they find a new job, but you need to let the door revolve. MSPs serve an important role in the tech job industry, they are the shitty jobs everyone takes as an entry level tech to go find a less shitty job once they have some experience. If you are just starting out, its unlikely that you are going to be able to pay to retain top tier talent; so don’t waste your money or time trying. Just let the door revolve, and go start a few more careers.

## Find Out What You Are Really Good At, and Stop Doing Everything Else

If you are successful, hire the right people, and automate your workflows to a militant degree, you will eventually find a niche.

One of the companies I worked for found a niche in Business Continuity services. Our mistake was not pivoting to doing BCS exclusively while we had the opportunity to do so. If you look at a lot of software companies in the MSP space, they found a niche and then started selling their software or services to other MSPs. This is the dream. Even if you stay in the service industry, its way easier to sell yourself as a specialized provider (or better yet, software provider that offers services) than generic catch all tech support. And there is the possibility you will actually make money. So when you see your opportunity to jump ship and fill a niche; Do it.

All MSP markets outside of dedicated government contractors are a race to the bottom. You might not cut costs, but your competition will. And they are probably better at it than you.

